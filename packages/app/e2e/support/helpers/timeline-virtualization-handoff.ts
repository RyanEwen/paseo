import { expect, type Page, type TestInfo } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { startTimelineRecording, finishTimelineRecording } from "./timeline-scroll-smoothness";
import { seedMockAgentWorkspace } from "./mock-agent";
import {
  holdOlderHistoryPages,
  openAgentTimeline,
  expectTimelinePromptVisible,
  userScrollsTimelineToHistoryStart,
} from "./timeline-pagination";

/** Hold a prepend at a nonzero reader offset while the ordinary timeline becomes virtualized. */
export async function expectVirtualizationHandoffContinuity(
  page: Page,
  testInfo: TestInfo,
): Promise<void> {
  await page.addInitScript(() => {
    Reflect.set(globalThis, "__PASEO_E2E_WEB_PARTIAL_VIRTUALIZATION_THRESHOLD", 50);
    Reflect.set(globalThis, "__PASEO_E2E_WEB_MOUNTED_RECENT_STREAM_ITEMS", 20);
  });
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "timeline-virtualization-handoff-",
    title: "Virtualization handoff reading position",
    featureValues: {
      mockAssistantResponses: Array.from(
        { length: 40 },
        (_, turn) =>
          `Settled plain text for handoff turn ${turn}. ${"Keep the reader in place. ".repeat(5)}`,
      ),
    },
  });
  try {
    for (let turn = 0; turn < 40; turn += 1) {
      await agent.client.sendAgentMessage(agent.agentId, `Handoff turn ${turn}`);
      await agent.client.waitForFinish(agent.agentId, 15_000);
    }
    const history = await holdOlderHistoryPages(page, agent);
    await openAgentTimeline(page, agent);
    await expectTimelinePromptVisible(page, "Handoff turn 39");
    const timeline = page.getByTestId("agent-chat-scroll");
    await expect(timeline).toHaveAttribute("id", /web-dom-scroll$/);
    await userScrollsTimelineToHistoryStart(page);
    await history.expectRequestedPages(1);
    await timeline.evaluate((element) => {
      element.scrollTop = 56;
    });
    await expect.poll(() => timeline.evaluate((element) => element.scrollTop)).toBe(56);
    const reader = timeline
      .locator("[data-history-row-id]")
      .filter({ hasText: "Handoff turn 20" })
      .first();
    await expect(reader).toBeAttached();
    const position = () =>
      reader.evaluate((element) => {
        const scroll = element.closest('[data-testid="agent-chat-scroll"]')!;
        return element.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
      });
    const before = await position();
    await expect(timeline).toHaveAttribute("id", /web-dom-scroll$/);
    const readerId = await reader.getAttribute("data-history-row-id");
    await startTimelineRecording(page);
    history.releasePage(1);
    await expect(timeline).toHaveAttribute("id", /web-dom-virtualized$/);
    await history.expectSettledWithRequestedPages(1);
    const frames = await finishTimelineRecording(page);
    const path = testInfo.outputPath("handoff-frames.json");
    await writeFile(path, JSON.stringify({ before, frames }));
    await testInfo.attach("handoff-frames", { path, contentType: "application/json" });
    expect(frames.length).toBeGreaterThan(1);
    const readers = frames.map((frame) => frame.rows.filter((row) => row.id === readerId));
    expect(
      readers.map((rows) => rows.length),
      "reader stays mounted through handoff",
    ).toEqual(frames.map(() => 1));
    for (const rows of readers) {
      expect(rows[0]!.top, "reader stays steady in every painted frame").toBeCloseTo(before, 0);
    }
    expect(
      await position(),
      "virtualizer attachment preserves the nonzero reader offset",
    ).toBeCloseTo(before, 0);
  } finally {
    await agent.cleanup();
  }
}
