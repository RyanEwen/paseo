import { writeFile } from "node:fs/promises";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { seedMockAgentWorkspace } from "./mock-agent";
import { openAgentTimeline, expectTimelinePromptVisible } from "./timeline-pagination";
import { withHeldImage } from "./held-http-image";
import {
  startTimelineRecording,
  finishTimelineRecording,
  attachTimelineScreenshot,
} from "./timeline-scroll-smoothness";

/** Prove text continuity with real wheel input on either side of an explicitly held image resize. */
export async function expectShrinkingImageContinuity(
  page: Page,
  testInfo: TestInfo,
  order: "wheel-first" | "resize-first",
): Promise<void> {
  await page.addInitScript(() => {
    Reflect.set(globalThis, "__PASEO_E2E_WEB_PARTIAL_VIRTUALIZATION_THRESHOLD", 10);
    Reflect.set(globalThis, "__PASEO_E2E_WEB_MOUNTED_RECENT_STREAM_ITEMS", 5);
  });
  await withHeldImage(960, 240, async (url, release) => {
    const agent = await seedMockAgentWorkspace({
      repoPrefix: "shrinking-timeline-image-",
      title: "Image shrink reading continuity",
      featureValues: {
        mockAssistantResponses: Array.from({ length: 12 }, (_, turn) =>
          turn === 8
            ? `![Controlled landscape](${url})\n\n\`\`\`typescript\nconst continuity_boundary = true;\n${"inspect(continuity_boundary);\n".repeat(8)}\`\`\`\n\n> Visible text below the image.\n\n- Keep this text steady\n- Preserve the reader`
            : Array.from(
                { length: 5 },
                (_value, block) =>
                  `Static history ${turn}, block ${block}. ${"Settled text before the controlled image. ".repeat(5)}`,
              ).join("\n\n"),
        ),
      },
    });
    try {
      for (let turn = 0; turn < 12; turn += 1) {
        await agent.client.sendAgentMessage(agent.agentId, `Continuity turn ${turn}`);
        await agent.client.waitForFinish(agent.agentId, 15_000);
      }
      await openAgentTimeline(page, agent);
      await expectTimelinePromptVisible(page, "Continuity turn 11");
      const timeline = page.getByTestId("agent-chat-scroll");
      const image = page.getByRole("img", { name: "Controlled landscape" }).first();
      await timeline.hover();
      for (let step = 0; step < 30 && !(await image.count()); step += 1) {
        await page.mouse.wheel(0, -300);
        await page.waitForTimeout(50);
      }
      await expect(image).toBeAttached();
      const code = page
        .locator("[data-history-row-id]")
        .filter({ hasText: "const continuity_boundary" })
        .first();
      await expect(code).toBeAttached();
      await page.evaluate(() => document.fonts.ready);
      // Establish the initial position only. The decisive movement below uses a real wheel event.
      await code.evaluate((element) => {
        const scroll = document.querySelector('[data-testid="agent-chat-scroll"]') as HTMLElement;
        scroll.scrollTop +=
          element.getBoundingClientRect().top - scroll.getBoundingClientRect().top + 117;
      });
      const geometry = () =>
        code.evaluate((element) => {
          const scroll = document.querySelector('[data-testid="agent-chat-scroll"]') as HTMLElement;
          return element.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
        });
      await expect.poll(async () => Math.round(await geometry())).toBe(-117);
      await expect(image.locator("xpath=ancestor::*[@data-index][1]")).toBeAttached();
      await startTimelineRecording(page);
      const initial = await geometry();
      const wheel = async () => {
        await page.mouse.wheel(0, -160);
        await expect.poll(async () => Math.round(await geometry())).toBe(Math.round(initial + 160));
      };
      if (order === "wheel-first") await wheel();
      const beforeResize = await geometry();
      await attachTimelineScreenshot(page, testInfo, "before-controlled-shrink");
      release();
      await expect
        .poll(() => image.evaluate((element) => element.querySelector("img")?.naturalWidth))
        .toBe(960);
      await expect
        .poll(async () => {
          const bounds = await image.boundingBox();
          return bounds ? Math.round((bounds.width / bounds.height) * 100) : 0;
        })
        .toBe(400);
      const afterResize = await geometry();
      if (order === "resize-first") await wheel();
      const codeId = await code.getAttribute("data-history-row-id");
      const frames = await finishTimelineRecording(page);
      const path = testInfo.outputPath("controlled-shrink-frames.json");
      await writeFile(path, JSON.stringify({ order, initial, beforeResize, afterResize, frames }));
      await testInfo.attach("controlled-shrink-frames", { path, contentType: "application/json" });
      await attachTimelineScreenshot(page, testInfo, "after-controlled-shrink");
      // Every painted text position must belong to the actual wheel transition,
      // including idle frames; a later correction cannot conceal a transient jump.
      expect(
        frames.length,
        "painted-frame evidence covers the transition and idle window",
      ).toBeGreaterThan(1);
      const monitoredRows = frames.map((frame) => frame.rows.filter((row) => row.id === codeId));
      expect(
        monitoredRows.map((rows) => rows.length),
        "text remains mounted in every recorded frame",
      ).toEqual(frames.map(() => 1));
      const visibleRows = monitoredRows.map((rows, index) => {
        const row = rows[0]!;
        return row.top < frames[index]!.viewportHeight && row.top + row.height > 8;
      });
      expect(visibleRows, "monitored text remains visible in every recorded frame").toEqual(
        frames.map(() => true),
      );
      const textPositions = monitoredRows.map((rows) => rows[0]!.top);
      expect(Math.min(...textPositions)).toBeGreaterThanOrEqual(initial - 1);
      expect(Math.max(...textPositions)).toBeLessThanOrEqual(initial + 161);
      const reversals = textPositions
        .slice(1)
        .filter((position, index) => position < textPositions[index]! - 1);
      expect(reversals, "painted text never reverses during upward input or resize").toEqual([]);

      expect(
        afterResize,
        "image shrink keeps the already-visible text boundary steady",
      ).toBeCloseTo(beforeResize, 0);
      expect(await geometry(), "both event orders reach the same text position").toBeCloseTo(
        initial + 160,
        0,
      );
    } finally {
      await agent.cleanup();
    }
  });
}
