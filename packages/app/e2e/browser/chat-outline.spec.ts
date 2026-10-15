import { expectSingleLineStickyGeometry } from "../support/helpers/sticky-preview-geometry";
import { observePromptPointer } from "../support/helpers/prompt-pointer-observation";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { expect, test } from "../support/fixtures";
import { expectNearBottom } from "../support/helpers/agent-bottom-anchor";
import { fillComposerDraft, expectComposerDraft, submitMessage } from "../support/helpers/composer";
import { installDaemonWebSocketGate } from "../support/helpers/daemon-websocket-gate";
import { trackPromptJumpRequests } from "../support/helpers/agent-timeline-gate";
import {
  clickChatOutlineRowEdge,
  disableChatOutlineFromAppearance,
  expectActiveChatOutlinePrompt,
  expectActiveChatOutlinePromptMovedFrom,
  expectChatOutlinePreview,
  expectChatOutlinePrompts,
  expectChatOutlinePromptToRemainBare,
  expectLiveTurnPromptAboveFoldAndActive,
  expectNoChatOutlinePreviewWhileCrossingToSidebar,
  expectNoChatOutline,
  expectNoChatOutlinePreview,
  expectOneActiveChatOutlinePrompt,
  focusChatOutlinePrompt,
  hoverChatOutlinePrompt,
  chatOutlineRail,
  movePointerOffChatOutline,
  observePromptIndexRequests,
  pointAtChatOutlineRowEdge,
  pressEnterOnFocusedPrompt,
  splitCurrentPanelRight,
  withStreamingMarkdownOutline,
  expectReadingStreamedMarkdown,
} from "../support/helpers/chat-outline";
import { createCreationScenario } from "../support/helpers/creation";
import {
  expectTimelineAtMaximumScrollWithPromptVisible,
  expectTimelinePromptNotMounted,
  expectTimelinePromptLandedBelowTop,
  expectTimelinePromptVisible,
  holdOlderHistoryPages,
  openAgentTimeline,
  scrollThroughOlderHistoryPages,
  scrollTimelineToNewestLoadedEdge,
  seedLongMockAgentTimeline,
  scrollTimelinePastPrompt,
  scrollTimelinePromptIntoView,
  waitForTimelineGeometryToSettle,
  type LongTimelineAgent,
} from "../support/helpers/timeline-pagination";

// Wide enough that the timeline panel clears the rail's MIN_PANEL_WIDTH with room
// to spare. At 1280 the panel measures 960, which sits too close to the threshold
// for chrome-width changes elsewhere to stay out of these tests.
const WIDE_VIEWPORT = { width: 1440, height: 900 };
const LOADED_TURNS = 16;

test.describe("desktop chat outline", () => {
  test("keeps the prompt marked while reading split Markdown blocks and after completion", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const prompt = "Explain in several paragraphs.";
    await withStreamingMarkdownOutline(async (agent) => {
      await agent.client.sendAgentMessage(agent.agentId, "Earlier prompt.");
      await agent.client.waitForFinish(agent.agentId, 30_000);
      await page.setViewportSize(WIDE_VIEWPORT);
      await openAgentTimeline(page, agent);
      await agent.client.sendAgentMessage(agent.agentId, prompt);
      await expectChatOutlinePrompts(page, 2);

      await expectReadingStreamedMarkdown(page, prompt);
      await expectActiveChatOutlinePrompt(page, 2);
      await agent.client.waitForFinish(agent.agentId, 30_000);
      await expectActiveChatOutlinePrompt(page, 2);

      await page.reload({ waitUntil: "domcontentloaded" });
      await expectActiveChatOutlinePrompt(page, 2);
      await clickChatOutlineRowEdge(page, 2);
      await expectTimelinePromptLandedBelowTop(page, prompt);
    });
  });

  test("indexes unloaded prompts and jumps with one bounded merged page", async ({ page }) => {
    test.setTimeout(120_000);
    const agent = await seedLongMockAgentTimeline({ turns: 80 });
    try {
      const jumps = await trackPromptJumpRequests(page, agent.agentId);
      await page.setViewportSize(WIDE_VIEWPORT);
      await openAgentTimeline(page, agent);

      const rail = chatOutlineRail(page);
      await expectChatOutlinePrompts(page, 80);
      await expectTimelinePromptNotMounted(page, agent.oldestPrompt);

      await rail.getByRole("tab").nth(39).click();
      await expectTimelinePromptLandedBelowTop(page, agent.prompts[39]);
      await expect.poll(() => jumps.requests()).toHaveLength(1);
      expect(jumps.requests()[0]).toMatchObject({ limit: 40, mergeWindow: true });

      await page.getByTestId("scroll-to-bottom-button").click();
      await expectTimelinePromptVisible(page, agent.newestPrompt);

      const requestsBeforeLoadedJump = jumps.requests().length;
      await rail.getByRole("tab").last().click();
      await expectTimelinePromptVisible(page, agent.newestPrompt);
      expect(jumps.requests()).toHaveLength(requestsBeforeLoadedJump);

      await rail.getByRole("tab").first().click();
      await expectTimelinePromptVisible(page, agent.oldestPrompt);
      await agent.client.sendAgentMessage(agent.agentId, "live prompt while viewing old history");
      await agent.client.waitForFinish(agent.agentId, 15_000);
      await expectTimelinePromptVisible(page, agent.oldestPrompt);
    } finally {
      await agent.cleanup();
    }
  });

  test.describe("with the whole conversation loaded", () => {
    let agent: LongTimelineAgent;

    test.beforeAll(async () => {
      test.setTimeout(120_000);
      agent = await seedLongMockAgentTimeline({ turns: LOADED_TURNS });
    });

    test.afterAll(async () => {
      await agent.cleanup();
    });

    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(WIDE_VIEWPORT);
      await openAgentTimeline(page, agent);
      await expectChatOutlinePrompts(page, LOADED_TURNS);
    });

    test("previews the prompt under the pointer, anywhere across its row", async ({ page }) => {
      await hoverChatOutlinePrompt(page, 2);
      await expectChatOutlinePreview(page, agent.prompts[1]);

      await pointAtChatOutlineRowEdge(page, 7);
      await expectChatOutlinePreview(page, agent.prompts[6]);

      await movePointerOffChatOutline(page);
      await expectNoChatOutlinePreview(page);
    });

    test("does not preview while crossing the rail toward the sidebar", async ({ page }) => {
      await expectNoChatOutlinePreviewWhileCrossingToSidebar(page);
    });

    test("closes the preview when the pointer leaves after a jump", async ({ page }) => {
      await clickChatOutlineRowEdge(page, 4);
      await movePointerOffChatOutline(page);

      await expectNoChatOutlinePreview(page);
    });

    test("previews and jumps to the focused prompt from the keyboard", async ({ page }) => {
      await focusChatOutlinePrompt(page, 1);
      await expectChatOutlinePreview(page, agent.prompts[0]);
      await expectTimelinePromptNotMounted(page, agent.oldestPrompt);

      await pressEnterOnFocusedPrompt(page);
      await expectTimelinePromptLandedBelowTop(page, agent.oldestPrompt);
      await expectActiveChatOutlinePrompt(page, 1);
    });

    test("moves the active mark as the reader jumps and scrolls", async ({ page }) => {
      await expectOneActiveChatOutlinePrompt(page);

      await clickChatOutlineRowEdge(page, 4);
      await expectTimelinePromptLandedBelowTop(page, agent.prompts[3]);
      await expectActiveChatOutlinePrompt(page, 4);

      await scrollTimelineToNewestLoadedEdge(page);
      await expectTimelinePromptVisible(page, agent.newestPrompt);
      await expectActiveChatOutlinePromptMovedFrom(page, 4);
    });

    test("keeps a clicked prompt free of persistent selection chrome", async ({ page }) => {
      await clickChatOutlineRowEdge(page, 4);

      await expectChatOutlinePromptToRemainBare(page, 4);
    });

    test("clamps the newest prompt at maximum scroll while keeping it visible", async ({
      page,
    }) => {
      await clickChatOutlineRowEdge(page, LOADED_TURNS);

      await expectTimelineAtMaximumScrollWithPromptVisible(page, agent.newestPrompt);
    });

    test("keeps the current prompt active throughout a long live assistant turn", async ({
      page,
    }) => {
      const prompt = "chat outline live turn reading position";
      await agent.client.sendAgentMessage(agent.agentId, prompt);
      try {
        await expectLiveTurnPromptAboveFoldAndActive(page, prompt, LOADED_TURNS + 1);
      } finally {
        await agent.client.waitForFinish(agent.agentId, 15_000);
      }
    });
  });

  test.describe("with virtualized loaded history", () => {
    let agent: LongTimelineAgent;

    test.beforeAll(async () => {
      test.setTimeout(120_000);
      agent = await seedLongMockAgentTimeline({ turns: 80 });
    });

    test.afterAll(async () => {
      await agent.cleanup();
    });

    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(WIDE_VIEWPORT);
    });

    test("pins a loaded prompt inside the virtualized block without fetching", async ({ page }) => {
      const history = await holdOlderHistoryPages(page, agent);
      await openAgentTimeline(page, agent);
      await expectChatOutlinePrompts(page, 80);
      await scrollThroughOlderHistoryPages(page, 2, history);
      await scrollTimelineToNewestLoadedEdge(page);
      const requestsBeforeJump = history.requestCount();

      await clickChatOutlineRowEdge(page, 30);
      await expectTimelinePromptLandedBelowTop(page, agent.prompts[29]);

      expect(history.requestCount()).toBe(requestsBeforeJump);
    });

    test("pins a newer loaded prompt when jumping downward from old history", async ({ page }) => {
      const history = await holdOlderHistoryPages(page, agent);
      await openAgentTimeline(page, agent);
      await expectChatOutlinePrompts(page, 80);
      await scrollThroughOlderHistoryPages(page, 2, history);
      await scrollTimelineToNewestLoadedEdge(page);

      await clickChatOutlineRowEdge(page, 30);
      await expectTimelinePromptLandedBelowTop(page, agent.prompts[29]);

      await clickChatOutlineRowEdge(page, 60);

      await expectTimelinePromptLandedBelowTop(page, agent.prompts[59]);
    });
  });

  test("hides the rail when a split makes its panel narrow", async ({ page }) => {
    const agent = await seedLongMockAgentTimeline({ turns: 2 });
    try {
      await page.setViewportSize(WIDE_VIEWPORT);
      await openAgentTimeline(page, agent);

      await splitCurrentPanelRight(page);

      await expectNoChatOutline(page);
    } finally {
      await agent.cleanup();
    }
  });

  test("can be disabled from Appearance settings", async ({ page }) => {
    const agent = await seedLongMockAgentTimeline({ turns: 2 });
    try {
      await page.setViewportSize(WIDE_VIEWPORT);
      await openAgentTimeline(page, agent);

      await disableChatOutlineFromAppearance(page);

      await expectNoChatOutline(page);
    } finally {
      await agent.cleanup();
    }
  });
});

test("indexes a new agent's prompts only once the agent exists", async ({ page }) => {
  const promptIndex = await observePromptIndexRequests(page);
  const creation = await createCreationScenario(page);
  try {
    await page.setViewportSize(WIDE_VIEWPORT);
    await creation.openAgentDraft();
    await creation.submitPrompt("Start an agent with an outline.");
    await creation.expectPromptVisible();

    const agentIds = await creation.agentIds();
    expect(agentIds).toHaveLength(1);
    await promptIndex.waitForRequestFor(agentIds[0]!);
    expect(promptIndex.requestedAgentIds()).toEqual(agentIds);
  } finally {
    await creation.cleanup();
  }
});

/** Reveal desktop actions through their existing hover owner before clicking. */
async function clickMessageNavigation(message: Locator, testID: string) {
  await message.getByTestId("user-message-bubble").hover();
  await message.getByTestId(testID).click();
}

/** Arrow navigation must own the pinned surface at the measured original bubble edge. */
async function expectPinnedPromptLanding(page: Page, prompt: string) {
  const pinned = page.getByTestId("sticky-user-message");
  await expect(pinned).toContainText(prompt);
  const timeline = page.getByTestId("agent-chat-scroll");
  const bubble = timeline
    .getByTestId("user-message")
    .filter({ hasText: prompt })
    .getByTestId("user-message-bubble");
  await expect
    .poll(async () => {
      const [viewport, original] = await Promise.all([
        timeline.boundingBox(),
        bubble.boundingBox(),
      ]);
      return viewport && original
        ? Math.abs(original.y - viewport.y + 2)
        : Number.POSITIVE_INFINITY;
    })
    .toBeLessThanOrEqual(2);
}

/** The disclosure reserves its own column inside the bubble, without covering text. */
async function expectInlinePromptDisclosure(message: Locator) {
  const text = await message.locator("[data-message-text=true]").boundingBox();
  const disclosure = await message.getByTestId("sticky-user-message-disclosure").boundingBox();
  expect(text).not.toBeNull();
  expect(disclosure).not.toBeNull();
  expect(text!.x + text!.width).toBeLessThanOrEqual(disclosure!.x);
  const bubble = (await message.getByTestId("user-message-bubble").boundingBox())!;
  expect(disclosure!.y).toBeGreaterThanOrEqual(bubble.y);
  expect(disclosure!.y + disclosure!.height).toBeLessThanOrEqual(bubble.y + bubble.height);
}

/** Keep pointer observation and original-message landing identical across destination geometries. */
async function expectStationaryPromptLanding(
  page: Page,
  testInfo: TestInfo,
  prior: string,
  origin: "pinned" | "original" = "pinned",
) {
  const newest = `Current response context\nemit 8 assistant messages before synthetic user message\n${"A shared-width line keeps the real bubble under the pointer.\n".repeat(8)}`;
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "sticky-stationary-pointer",
    title: "Sticky stationary pointer",
    initialPrompt: "Earlier context",
  });
  try {
    await agent.client.waitForFinish(agent.agentId, 15_000);
    for (const prompt of [prior, newest]) {
      await agent.client.sendAgentMessage(agent.agentId, prompt);
      await agent.client.waitForFinish(agent.agentId, 15_000);
    }
    await page.setViewportSize(WIDE_VIEWPORT);
    await openAgentRoute(page, agent);
    const sticky = page.getByTestId("sticky-user-message");
    let source: Locator;
    if (origin === "original") {
      // An earlier prompt can remain pinned while this full original is visible below it.
      // Validate this source's pixel ownership rather than banning unrelated sticky context.
      await scrollTimelinePromptIntoView(page, newest);
      source = page
        .getByTestId("agent-chat-scroll")
        .getByTestId("user-message")
        .filter({ hasText: newest });
    } else {
      await scrollTimelinePastPrompt(page, newest);
      await expect(sticky).toContainText("Current response context");
      source = sticky;
    }
    await source.getByTestId("user-message-bubble").hover();
    const previous = source.getByTestId(
      origin === "original" ? "user-message-previous" : "sticky-user-message-previous",
    );
    await expect(previous).toBeEnabled();
    if (origin === "original") {
      await expect(source.getByTestId("user-message-bubble")).toBeInViewport({ ratio: 1 });
      const sourceControls = source.getByTestId("user-message-trailing-row");
      await expect(sourceControls).not.toHaveAttribute("aria-hidden", "true");
      await expect(sourceControls).toHaveCSS("opacity", "1");
      await expect(sourceControls).toHaveCSS("pointer-events", "auto");
      const uncovered = await previous.evaluate((button) => {
        const rect = button.getBoundingClientRect();
        const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        const hit = document.elementFromPoint(point.x, point.y);
        return { point, hitInsideControl: hit !== null && button.contains(hit) };
      });
      await testInfo.attach("original-source-before-click", {
        body: JSON.stringify(uncovered, null, 2),
        contentType: "application/json",
      });
      await page.screenshot({ path: testInfo.outputPath("original-source-before-click.png") });
      expect(uncovered.hitInsideControl).toBe(true);
    }
    const observation = await observePromptPointer(previous);
    try {
      // This is the last pointer-driving action. Landing and observation cannot move it.
      await previous.click();
      await expectPinnedPromptLanding(page, prior);
      await waitForTimelineGeometryToSettle(page);
      const original = sticky;
      await expect(original).toHaveCount(1);
      const controls = original.getByTestId("user-message-trailing-row");
      const pointer = await observation.read(original);
      const observed = {
        ...pointer,
        origin,
        ownership: {
          stickyCopies: await sticky.count(),
          originalAriaHidden: await original.getAttribute("aria-hidden"),
          previousDisabled: await controls
            .getByTestId("sticky-user-message-previous")
            .getAttribute("aria-disabled"),
        },
      };
      await testInfo.attach("stationary-pointer-landing", {
        body: JSON.stringify(observed, null, 2),
        contentType: "application/json",
      });
      await page.screenshot({ path: testInfo.outputPath("stationary-pointer-landing.png") });
      expect(observed.movesAfterClick).toBe(0);
      await expect(sticky).toHaveCount(1);
      await expect(controls.getByTestId("sticky-user-message-previous")).toBeEnabled();
      await expect(controls.getByRole("button")).toHaveCount(4);
      if (origin === "original") {
        // This approved visibility hold is separate from hover: the causal fixture's
        // stationary point stays below the short destination after the real jump.
        expect(observed.hitInsideHoverWrapper).toBe(false);
        expect(observed.wrapperHovered).toBe(false);
        expect(observed.trailingOpacity).toBe("1");
        expect(observed.trailingPointerEvents).toBe("auto");
        await expect(controls).not.toHaveAttribute("aria-hidden", "true");

        if (!observed.point)
          throw new Error("The original arrow click has no recorded pointer point");
        await page.mouse.move(observed.point.x + 1, observed.point.y);
        await expect(controls).toHaveCSS("opacity", "0");
        await expect(controls).toHaveCSS("pointer-events", "none");
        await page.screenshot({ path: testInfo.outputPath("destination-after-mouse-move.png") });
        const bubble = (await original.getByTestId("user-message-bubble").boundingBox())!;
        await page.mouse.move(bubble.x + bubble.width / 2, bubble.y + bubble.height / 2);
        await expect(controls).toHaveCSS("opacity", "1");
        await expect(controls).toHaveCSS("pointer-events", "auto");
        await page.mouse.move(20, 20);
        await expect(controls).toHaveCSS("opacity", "0");
        return;
      }
      // A failed hit/hover precondition distinguishes destination geometry from stale React state.
      expect(observed.hitInsideOriginal).toBe(true);
      expect(observed.hitInsideHoverWrapper).toBe(true);
      expect(observed.wrapperHovered).toBe(true);
      expect(observed.trailingOpacity).toBe("1");
      expect(observed.trailingPointerEvents).toBe("auto");
      await expect(controls).not.toHaveAttribute("aria-hidden", "true");
      await expect(controls).toHaveCSS("opacity", "1");
      await expect(controls).toHaveCSS("pointer-events", "auto");
    } catch (error) {
      const snapshot = await observation.snapshot();
      await testInfo.attach("stationary-pointer-before-failure", {
        body: JSON.stringify(snapshot, null, 2),
        contentType: "application/json",
      });
      await page.screenshot({ path: testInfo.outputPath("stationary-pointer-before-failure.png") });
      throw error;
    } finally {
      await observation.dispose();
    }
  } finally {
    await agent.cleanup();
  }
}

// Keep the previously passing long case, but do not rerun it for the new short-destination probe.
test("previous prompt preserves actual hover under a stationary pointer after landing", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  await expectStationaryPromptLanding(
    page,
    testInfo,
    `Previous response context\n${"A shared-width line keeps the real bubble under the pointer.\n".repeat(8)}`,
  );
});

for (const destination of [
  { name: "short", prompt: "Short." },
  { name: "one-line", prompt: "One line with enough width to hold the navigation landing." },
  { name: "multiline", prompt: "First line\nSecond line" },
]) {
  test(`stationary pointer controls after previous ${destination.name} prompt`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    await expectStationaryPromptLanding(page, testInfo, destination.prompt);
  });
}

test("consecutive pinned previous arrows preserve the second real click without mouse movement", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const oldest = "Oldest destination.";
  const middle = "Middle destination.";
  const newest = `Newest destination\nemit 8 assistant messages before synthetic user message\n${"Loaded context for the pinned arrow sequence.\n".repeat(8)}`;
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "sticky-consecutive-arrows",
    title: "Consecutive pinned arrows",
    initialPrompt: oldest,
  });
  try {
    await agent.client.waitForFinish(agent.agentId, 15_000);
    for (const prompt of [middle, newest]) {
      await agent.client.sendAgentMessage(agent.agentId, prompt);
      await agent.client.waitForFinish(agent.agentId, 15_000);
    }
    await page.setViewportSize(WIDE_VIEWPORT);
    await openAgentRoute(page, agent);
    await scrollTimelinePastPrompt(page, newest);
    const pinned = page.getByTestId("sticky-user-message");
    await expect(pinned).toContainText("Newest destination");
    await pinned.getByTestId("user-message-bubble").hover();
    const first = pinned.getByTestId("sticky-user-message-previous");
    const observation = await observePromptPointer(first);
    try {
      await first.click();
      await expectPinnedPromptLanding(page, middle);
      await waitForTimelineGeometryToSettle(page);
      const replacement = pinned;
      const beforeSecond = await observation.read(replacement);
      await testInfo.attach("replacement-before-second-click", {
        body: JSON.stringify(beforeSecond, null, 2),
        contentType: "application/json",
      });
      await page.screenshot({ path: testInfo.outputPath("replacement-before-second-click.png") });
      expect(beforeSecond.movesAfterClick).toBe(0);
      const next = replacement.getByTestId("sticky-user-message-previous");
      await expect(next).toBeEnabled();
      const point = beforeSecond.point;
      if (!point) throw new Error("The first pinned arrow did not record a real pointer point");
      const hit = await next.evaluate((button, clickPoint) => {
        const target = document.elementFromPoint(clickPoint.x, clickPoint.y);
        return target !== null && button.contains(target);
      }, point);
      expect(hit).toBe(true);
      // Press at the identical stationary point. Locator.click would be allowed to move it.
      await page.mouse.down();
      await page.mouse.up();
      await waitForTimelineGeometryToSettle(page);
      const afterSecond = await observation.read(pinned);
      await testInfo.attach("after-second-click", {
        body: JSON.stringify(afterSecond, null, 2),
        contentType: "application/json",
      });
      await page.screenshot({ path: testInfo.outputPath("after-second-click.png") });
      expect(afterSecond.movesAfterClick).toBe(0);
      expect(afterSecond.actions.filter((event) => event.type === "pointerdown")).toHaveLength(2);
      expect(afterSecond.actions.every((event) => event.trusted)).toBe(true);
      await expectPinnedPromptLanding(page, oldest);
      await expect(pinned.getByTestId("sticky-user-message-next")).toBeEnabled();
      await expect(pinned.getByTestId("user-message-trailing-row")).toHaveCSS("opacity", "1");
      // Clicking the content keeps its distinct original-message reveal behavior.
      await pinned.getByTestId("user-message-bubble").click();
      await expectTimelinePromptLandedBelowTop(page, oldest);
    } catch (error) {
      await testInfo.attach("consecutive-click-before-failure", {
        body: JSON.stringify(await observation.snapshot(), null, 2),
        contentType: "application/json",
      });
      await page.screenshot({ path: testInfo.outputPath("consecutive-click-before-failure.png") });
      throw error;
    } finally {
      await observation.dispose();
    }
  } finally {
    await agent.cleanup();
  }
});

test("original previous arrow observes stationary pointer ownership after landing", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  await expectStationaryPromptLanding(page, testInfo, "Short.", "original");
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`sticky preview discloses only rendered overflow at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    const prompts = [
      "Short prompt.",
      "First line\nSecond line",
      "**Heading**\n  indented `code`\nThird rendered line",
      `Long preview\n${"  actual content and whitespace\n".repeat(60)}END OF FULL PREVIEW`,
    ];
    const agent = await seedMockAgentWorkspace({
      repoPrefix: "sticky-preview",
      title: "Sticky overflow",
      initialPrompt: prompts[0],
    });
    try {
      await agent.client.waitForFinish(agent.agentId, 15_000);
      for (const prompt of prompts.slice(1)) {
        await agent.client.sendAgentMessage(agent.agentId, prompt);
        await agent.client.waitForFinish(agent.agentId, 15_000);
      }
      await agent.client.sendAgentMessage(
        agent.agentId,
        "emit 85 assistant messages before synthetic user message",
      );
      await agent.client.waitForFinish(agent.agentId, 15_000);
      // The outline rail is deliberately hidden on compact panes. Bootstrap the
      // route at desktop width, then navigate through the shared arrows after resizing.
      await page.setViewportSize(WIDE_VIEWPORT);
      await page.emulateMedia({ colorScheme: viewport.width === 390 ? "dark" : "light" });
      await openAgentRoute(page, agent);
      await expect(chatOutlineRail(page).getByRole("tab")).toHaveCount(5);
      await page.setViewportSize(viewport);
      const initialCopy = page.getByTestId("sticky-user-message");
      await expect(initialCopy).toContainText(
        "emit 85 assistant messages before synthetic user message",
      );
      for (let index = prompts.length - 1; index >= 0; index -= 1) {
        await clickMessageNavigation(initialCopy, "sticky-user-message-previous");
        await expectPinnedPromptLanding(page, prompts[index]!);
      }
      const timeline = page.getByTestId("agent-chat-scroll");
      const original = timeline.getByTestId("user-message").filter({ hasText: prompts[0]! });
      const realHeight = (await original.getByTestId("user-message-bubble").boundingBox())!.height;
      await expectSinglePaintedPromptHandoff(page, prompts[0]!, viewport.width);
      await scrollTimelinePastPrompt(page, prompts[0]!);
      const sticky = page.getByTestId("sticky-user-message");
      const disclosure = sticky.getByTestId("sticky-user-message-disclosure");
      await expect(disclosure).toHaveCount(0);
      await expect(sticky).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await expect(sticky.locator("svg linearGradient")).toHaveCount(0);
      await expect(sticky.getByTestId("user-message-bubble")).toHaveCSS(
        "border-top-left-radius",
        "0px",
      );
      const latestButton = page.getByTestId("scroll-to-bottom-button");
      await expect(latestButton).toBeVisible();
      const composer = page.getByTestId("message-input-root").filter({ visible: true });
      await expect(composer).toHaveCount(1);
      const composerBounds = (await composer.boundingBox())!;
      const latestBounds = (await latestButton.boundingBox())!;
      expect(latestBounds.x + latestBounds.width).toBeCloseTo(
        composerBounds.x + composerBounds.width,
        0,
      );
      expect(latestBounds.y + latestBounds.height).toBeLessThanOrEqual(composerBounds.y);
      expect((await sticky.getByTestId("user-message-bubble").boundingBox())!.height).toBeCloseTo(
        realHeight,
        0,
      );
      const shortGeometry = await expectSingleLineStickyGeometry(sticky);
      await page.screenshot({
        path: `../../docs/qa-evidence/sticky-user-message/short-preview-${viewport.width}.png`,
      });
      for (let index = 1; index < prompts.length; index += 1) {
        await clickMessageNavigation(sticky, "sticky-user-message-next");
        await expectPinnedPromptLanding(page, prompts[index]!);
        await expect(disclosure).toHaveText("more…");
        await expectInlinePromptDisclosure(sticky);
        const longGeometry = await expectSingleLineStickyGeometry(sticky);
        expect(longGeometry.height).toBeCloseTo(shortGeometry.height, 0);
        expect(longGeometry.controlsOffset).toBeCloseTo(shortGeometry.controlsOffset, 0);
        const stablePreview = await sticky.evaluate(async (node) => {
          const measurement = node.querySelector('[data-testid="text-preview-measurement"]')!;
          const text = measurement.parentElement!.parentElement!.firstElementChild!;
          const button = node.querySelector('[data-testid="sticky-user-message-disclosure"]')!;
          const lineHeight = Number.parseFloat(getComputedStyle(text).lineHeight);
          const height = text.getBoundingClientRect().height;
          // A disclosure must not remount its measured text or alternate its layout each frame.
          for (let frame = 0; frame < 24; frame += 1) {
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            if (
              !measurement.isConnected ||
              !button.isConnected ||
              text.getBoundingClientRect().height !== height
            ) {
              return { stable: false, height, lineHeight };
            }
          }
          return { stable: true, height, lineHeight };
        });
        expect(stablePreview.stable).toBe(true);
        expect(stablePreview.height).toBeLessThanOrEqual(stablePreview.lineHeight + 0.5);
        const collapsed = (await sticky.getByTestId("user-message-bubble").boundingBox())!.height;
        await disclosure.focus();
        await disclosure.press("Enter");
        await expect(disclosure).toHaveText("less…");
        await expect(sticky.getByTestId("text-preview-measurement")).toHaveCount(0);
        await expect(sticky.getByTestId("user-message")).toContainText(prompts[index]!);
        await disclosure.click();
        await expect(disclosure).toHaveText("more…");
        await expect
          .poll(async () => (await sticky.getByTestId("user-message-bubble").boundingBox())!.height)
          .toBe(collapsed);
      }
      // Put real conversation text behind the pinned copy for the appearance capture.
      await timeline.hover();
      await page.mouse.wheel(0, 100);
      await expect(sticky).toContainText("Long preview");
      await page.screenshot({
        path: `../../docs/qa-evidence/sticky-user-message/overflow-preview-${viewport.width}.png`,
      });
    } catch (error) {
      // Capture the still-owned conversation before agent cleanup can remove its route.
      try {
        const geometry = await page.evaluate(() => {
          const sticky = document.querySelector('[data-testid="sticky-user-message"]');
          const selectors = [
            '[data-testid="user-message-bubble"]',
            '[data-testid="user-message-text"]',
            '[data-testid="sticky-user-message-controls"]',
            '[data-testid="sticky-user-message-disclosure"]',
            "[data-message-text=true]",
          ];
          return {
            url: location.href,
            viewport: { width: innerWidth, height: innerHeight },
            nodes: selectors.map((selector) => {
              const node = sticky?.querySelector(selector);
              if (!node) return { selector, present: false };
              const style = getComputedStyle(node);
              return {
                selector,
                present: true,
                bounds: node.getBoundingClientRect().toJSON(),
                parentBounds: node.parentElement?.getBoundingClientRect().toJSON(),
                lineHeight: style.lineHeight,
                paddingTop: style.paddingTop,
                paddingBottom: style.paddingBottom,
                opacity: style.opacity,
                pointerEvents: style.pointerEvents,
              };
            }),
          };
        });
        await testInfo.attach("preview-failure-geometry", {
          body: JSON.stringify(geometry, null, 2),
          contentType: "application/json",
        });
      } catch (captureError) {
        console.error("preview geometry capture failed before cleanup", String(captureError));
      }
      try {
        await page.screenshot({
          path: testInfo.outputPath("preview-before-cleanup.png"),
          timeout: 2_000,
        });
      } catch (captureError) {
        console.error("preview screenshot capture failed before cleanup", String(captureError));
      }
      throw error;
    } finally {
      await agent.cleanup();
    }
  });

  test(`sticky user message navigation at ${viewport.width}px`, async ({ page }) => {
    test.setTimeout(180_000);
    const agent = await seedLongMockAgentTimeline({ turns: 20 });
    try {
      await page.setViewportSize(viewport);
      await openAgentTimeline(page, agent);
      const sticky = page.getByTestId("sticky-user-message");
      const previous = sticky.getByTestId("sticky-user-message-previous");
      const next = sticky.getByTestId("sticky-user-message-next");
      await expectTimelinePromptVisible(page, agent.newestPrompt);
      await expect(sticky).toHaveCount(0);
      const newestBubble = page
        .getByTestId("agent-chat-scroll")
        .getByTestId("user-message")
        .filter({ hasText: agent.newestPrompt });
      await expect(newestBubble.getByTestId("user-message-next")).toBeDisabled();
      const actionRow = newestBubble.getByTestId("user-message-trailing-row");
      await expect(actionRow.getByTestId("user-message-previous")).toHaveCount(1);
      await expect(actionRow.getByTestId("user-message-next")).toHaveCount(1);
      await expect(
        actionRow.getByRole("button", { name: "Copy message", exact: true }),
      ).toHaveCount(1);
      const actionBounds = await actionRow.boundingBox();
      if (viewport.width === 1440) {
        await page.mouse.move(2, 2);
        await expect
          .poll(() => actionRow.evaluate((node) => getComputedStyle(node).opacity))
          .toBe("0");
        await newestBubble.hover();
      }
      await expect
        .poll(() => actionRow.evaluate((node) => getComputedStyle(node).opacity))
        .toBe("1");
      expect(await actionRow.boundingBox()).toEqual(actionBounds);

      for (let index = agent.prompts.length - 2; index >= 0; index -= 1) {
        const original = page
          .getByTestId("agent-chat-scroll")
          .getByTestId("user-message")
          .filter({ hasText: agent.prompts[index + 1]! });
        if (await sticky.count()) {
          await clickMessageNavigation(sticky, "sticky-user-message-previous");
        } else {
          await clickMessageNavigation(original, "user-message-previous");
        }
        const target = page
          .getByTestId("agent-chat-scroll")
          .getByTestId("user-message")
          .filter({ hasText: agent.prompts[index]! });
        await expect(target).toBeInViewport();
        // The newest turns cannot always align at the top because the viewport clamps.
        // Older turns leave enough later content to scroll their original bubble offscreen.
        if (index < agent.prompts.length - 8) {
          await expectPinnedPromptLanding(page, agent.prompts[index]!);
          // Keep the existing original-edge handoff checks through the separate content action.
          await sticky
            .getByTestId("user-message-content-target")
            .click({ position: { x: 10, y: 4 } });
          await expectTimelinePromptLandedBelowTop(page, agent.prompts[index]!);
          if (index === 10) {
            const timeline = page.getByTestId("agent-chat-scroll");
            const viewportBox = await timeline.boundingBox();
            const originalBox = await target.boundingBox();
            await timeline.hover();
            await page.mouse.wheel(0, originalBox!.y - viewportBox!.y + 24);
            await expect(sticky).toBeVisible();
            await expect(target).toBeInViewport();
            await expect
              .poll(() => sticky.evaluate((element) => Number(getComputedStyle(element).opacity)))
              .toBe(1);
            const bubble = await sticky.getByTestId("user-message-bubble").boundingBox();
            const controls = await sticky.getByTestId("sticky-user-message-controls").boundingBox();
            expect(controls!.y).toBeGreaterThanOrEqual(bubble!.y + bubble!.height - 1);
            await page.screenshot({
              path: `../../docs/qa-evidence/sticky-user-message/handoff-${viewport.width}.png`,
            });
            await page.mouse.wheel(0, -40);
            await expect(sticky).toHaveCount(0);
          }
          await scrollTimelinePastPrompt(page, agent.prompts[index]!);
          if (index === 10) {
            const timeline = page.getByTestId("agent-chat-scroll");
            const newer = timeline
              .getByTestId("user-message")
              .filter({ hasText: agent.prompts[index + 1]! });
            const viewportBox = await timeline.boundingBox();
            const newerBox = await newer.boundingBox();
            await timeline.hover();
            await page.mouse.wheel(0, newerBox!.y - viewportBox!.y - 24);
            await expect(sticky).toContainText(agent.prompts[index]!);
            await expect(newer).toBeInViewport();
            await expect
              .poll(() =>
                sticky.evaluate((element) => element.parentElement!.getBoundingClientRect().height),
              )
              .toBeLessThan(40);
            await expect(sticky.getByTestId("sticky-user-message-disclosure")).toHaveCount(
              viewport.width === 1440 ? 0 : 1,
            );
            const visibleNewer = await newer.boundingBox();
            const paintedMessage = await page.evaluate(
              ({ x, y }) =>
                document.elementFromPoint(x, y)?.closest('[data-testid="user-message"]')
                  ?.textContent,
              { x: visibleNewer!.x + visibleNewer!.width / 2, y: visibleNewer!.y + 30 },
            );
            expect(paintedMessage).toContain(agent.prompts[index + 1]!);
            await page.screenshot({
              path: `../../docs/qa-evidence/sticky-user-message/overlap-${viewport.width}.png`,
            });
            await page.mouse.wheel(0, 70);
            await expect(sticky).toContainText(agent.prompts[index + 1]!);
            await page.mouse.wheel(0, -70);
            await expect(sticky).toContainText(agent.prompts[index]!);
          }
        }
      }
      await expect(previous).toBeDisabled();
      await clickMessageNavigation(sticky, "sticky-user-message-next");
      await expectPinnedPromptLanding(page, agent.prompts[1]!);
      // The bubble returns to itself; the arrows still navigate to adjacent prompts.
      await sticky.getByTestId("user-message-content-target").click({ position: { x: 10, y: 4 } });
      await expectTimelinePromptLandedBelowTop(page, agent.prompts[1]!);
      await expect(sticky).toHaveCount(0);
      await scrollTimelinePastPrompt(page, agent.prompts[1]!);
      const messageLink = sticky.getByTestId("user-message-text");
      const textBounds = (await messageLink.boundingBox())!;
      await page.mouse.move(textBounds.x + 4, textBounds.y + textBounds.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        textBounds.x + Math.min(textBounds.width - 4, 80),
        textBounds.y + textBounds.height / 2,
        { steps: 8 },
      );
      await page.mouse.up();
      await expect
        .poll(() => page.evaluate(() => window.getSelection()?.toString().length ?? 0))
        .toBeGreaterThan(0);
      await expect(sticky).toContainText(agent.prompts[1]!);
      await page.evaluate(() => window.getSelection()?.removeAllRanges());
      await expect(messageLink).toHaveAttribute("role", "link");
      await messageLink.focus();
      await messageLink.press("Enter");
      await expectTimelinePromptLandedBelowTop(page, agent.prompts[1]!);
      await expect(sticky).toHaveCount(0);
      await scrollTimelinePastPrompt(page, agent.prompts[1]!);
      const longPrompt = `Long sticky prompt\n${"  Preserve this line and whitespace.\n".repeat(60)}END OF STICKY PROMPT: emit 85 assistant messages before synthetic user message`;
      await agent.client.sendAgentMessage(agent.agentId, longPrompt);
      await agent.client.waitForFinish(agent.agentId, 15_000);
      await expect(sticky).toContainText(agent.prompts[1]);
      await page.getByTestId("scroll-to-bottom-button").click();
      await expect(sticky).toContainText("Long sticky prompt");
      await expectNearBottom(page);
      const collapsed = await sticky.boundingBox();
      expect(collapsed!.height).toBeLessThan(150);
      await sticky.getByRole("button", { name: "Expand user message", exact: true }).click();
      await expect(sticky).toContainText("END OF STICKY PROMPT");
      await expectNearBottom(page);
      const expanded = await sticky.boundingBox();
      expect(expanded!.height).toBeLessThan(viewport.height * 0.6);
      await page.screenshot({
        path: `../../docs/qa-evidence/sticky-user-message/expanded-${viewport.width}.png`,
      });
      await sticky.getByRole("button", { name: "Collapse user message", exact: true }).click();
      await expect(next).toBeDisabled();
      await expectNearBottom(page);
      await page.screenshot({
        path: `../../docs/qa-evidence/sticky-user-message/compact-${viewport.width}.png`,
      });
      await fillComposerDraft(page, "Unsent draft survives prompt disclosure");
      await sticky.getByRole("button", { name: "Expand user message", exact: true }).click();
      await sticky.getByRole("button", { name: "Collapse user message", exact: true }).click();
      await expectComposerDraft(page, "Unsent draft survives prompt disclosure");
      await page.setViewportSize({ width: viewport.width, height: 500 });
      await sticky.getByRole("button", { name: "Expand user message", exact: true }).click();
      await expect
        .poll(() =>
          sticky.evaluate((element) => {
            const paneHeight = element
              .closest('[data-testid="sticky-prompt-timeline"]')!
              .getBoundingClientRect().height;
            return element.getBoundingClientRect().height / paneHeight;
          }),
        )
        .toBeLessThan(0.8);
      await expectNearBottom(page);
      await sticky.getByRole("button", { name: "Collapse user message", exact: true }).click();
      await page.setViewportSize(viewport);
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("sticky-user-message")).toContainText("Long sticky prompt");
    } finally {
      await agent.cleanup();
    }
  });
}

test("sticky user message exposes index loading and a retryable failure", async ({ page }) => {
  test.setTimeout(120_000);
  const agent = await seedLongMockAgentTimeline({ turns: 2 });
  const gate = await installDaemonWebSocketGate(page);
  try {
    gate.failPromptIndexResponses(agent.agentId);
    gate.holdNextServerMessage("agent.timeline.list_prompts.response");
    await openAgentTimeline(page, agent);
    const sticky = page.getByTestId("sticky-user-message");
    await gate.waitForHeldServerMessage("agent.timeline.list_prompts.response");
    await expect(sticky.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
    gate.releaseHeldServerMessage("agent.timeline.list_prompts.response");
    await expect(sticky.getByRole("alert")).toHaveText("Could not load user messages.");
    gate.allowPromptIndexResponses();
    await sticky.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(sticky.getByRole("alert")).toHaveCount(0);
    await expect(sticky).toHaveCount(0);
    await clickMessageNavigation(
      page
        .getByTestId("agent-chat-scroll")
        .getByTestId("user-message")
        .filter({ hasText: agent.newestPrompt }),
      "user-message-previous",
    );
    await expect(
      page
        .getByTestId("agent-chat-scroll")
        .getByTestId("user-message")
        .filter({ hasText: agent.oldestPrompt }),
    ).toBeInViewport();
  } finally {
    await agent.cleanup();
  }
});

/** Observe delivery at the client, beyond the server gate's held-arrival acknowledgement. */
async function observeDeliveredTimelinePages(page: Page) {
  await page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    const state = window as unknown as { stickyTimelineResponses: number };
    state.stickyTimelineResponses = 0;
    window.WebSocket = class extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        this.addEventListener("message", (event) => {
          try {
            const envelope = JSON.parse(event.data);
            if ((envelope.message ?? envelope).type === "fetch_agent_timeline_response")
              state.stickyTimelineResponses += 1;
          } catch {
            /* Binary transport frames are unrelated. */
          }
        });
      }
    };
  });
  return {
    count: () =>
      page.evaluate(
        () => (window as unknown as { stickyTimelineResponses: number }).stickyTimelineResponses,
      ),
    async waitFor(count: number) {
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as unknown as { stickyTimelineResponses: number }).stickyTimelineResponses,
          ),
        )
        .toBeGreaterThanOrEqual(count);
    },
  };
}

test("sticky cancelled older window stays at latest after bottom", async ({ page }) => {
  test.setTimeout(120_000);
  const agent = await seedLongMockAgentTimeline({ turns: 30 });
  const gate = await installDaemonWebSocketGate(page);
  const delivered = await observeDeliveredTimelinePages(page);
  try {
    await page.setViewportSize(WIDE_VIEWPORT);
    await openAgentTimeline(page, agent);
    await expectChatOutlinePrompts(page, 30);
    await chatOutlineRail(page).getByRole("tab").nth(22).click();
    await expectTimelinePromptLandedBelowTop(page, agent.prompts[22]!);
    gate.holdNextServerMessage("fetch_agent_timeline_response");
    await chatOutlineRail(page).getByRole("tab").first().click();
    await gate.waitForHeldServerMessage("fetch_agent_timeline_response");
    await page.getByTestId("scroll-to-bottom-button").click();
    await expectNearBottom(page);
    const before = await delivered.count();
    gate.releaseHeldServerMessage("fetch_agent_timeline_response");
    await delivered.waitFor(before + 1);
    await expectNearBottom(page);
    await expectTimelinePromptVisible(page, agent.newestPrompt);
    await expect(page.getByTestId("sticky-user-message")).toHaveCount(0);
  } finally {
    await agent.cleanup();
  }
});

test("sticky composer submission cancels a held older window", async ({ page }) => {
  test.setTimeout(180_000);
  const agent = await seedLongMockAgentTimeline({ turns: 30 });
  const gate = await installDaemonWebSocketGate(page);
  const delivered = await observeDeliveredTimelinePages(page);
  try {
    await page.setViewportSize(WIDE_VIEWPORT);
    await openAgentTimeline(page, agent);
    await expectChatOutlinePrompts(page, 30);
    await chatOutlineRail(page).getByRole("tab").nth(22).click();
    await expectTimelinePromptLandedBelowTop(page, agent.prompts[22]!);
    gate.holdNextServerMessage("fetch_agent_timeline_response");
    await chatOutlineRail(page).getByRole("tab").first().click();
    await gate.waitForHeldServerMessage("fetch_agent_timeline_response");
    const sent = "Composer returns to latest: emit 1 coalesced agent stream updates";
    await submitMessage(page, sent);
    await expectNearBottom(page);
    const before = await delivered.count();
    gate.releaseHeldServerMessage("fetch_agent_timeline_response");
    await delivered.waitFor(before + 1);
    await agent.client.waitForFinish(agent.agentId, 15_000);
    await expectNearBottom(page);
    await expectTimelinePromptVisible(page, sent);
    await expect(page.getByTestId("sticky-user-message").getByRole("alert")).toHaveCount(0);
  } finally {
    await agent.cleanup();
  }
});

for (const indexed of [true, false]) {
  test(`sticky initial assistant-only pages expose loading, failure and retry (indexed: ${indexed})`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const agent = await seedMockAgentWorkspace({
      repoPrefix: "sticky-discovery-",
      title: "Sticky discovery",
    });
    const gate = await installDaemonWebSocketGate(page);
    const prompt = "emit 85 assistant messages before synthetic user message";
    try {
      await agent.client.sendAgentMessage(agent.agentId, prompt);
      await agent.client.waitForFinish(agent.agentId, 15_000);
      if (indexed) gate.failPromptIndexResponses(agent.agentId);
      else {
        gate.stripPromptIndex();
        gate.failTimelineResponses(agent.agentId, "before");
      }
      gate.holdNextServerMessage(
        indexed ? "agent.timeline.list_prompts.response" : "fetch_agent_timeline_response",
      );
      await page.setViewportSize(WIDE_VIEWPORT);
      await openAgentTimeline(page, agent);
      // Indexed discovery holds the index. Index-free discovery must allow bootstrap
      // before holding/failing the older page, so its first held tail is released here.
      await gate.waitForHeldServerMessage(
        indexed ? "agent.timeline.list_prompts.response" : "fetch_agent_timeline_response",
      );
      if (!indexed) gate.releaseHeldServerMessage("fetch_agent_timeline_response");
      const sticky = page.getByTestId("sticky-user-message");
      if (indexed) {
        await expect(sticky.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
        gate.releaseHeldServerMessage("agent.timeline.list_prompts.response");
      }
      await expect(sticky.getByRole("alert")).toHaveText("Could not load user messages.");
      gate.allowPromptIndexResponses();
      gate.allowTimelineResponses();
      await sticky.getByRole("button", { name: "Retry", exact: true }).click();
      await expect(sticky).toContainText(prompt);
      await expect(sticky.getByRole("alert")).toHaveCount(0);
      await expectNearBottom(page);
      await page.screenshot({
        path: `../../docs/qa-evidence/sticky-user-message/discovery-${indexed ? "indexed" : "pagination"}.png`,
      });
    } finally {
      await agent.cleanup();
    }
  });
}

/** Preserve glyph placement across LCD and grayscale antialiasing used by opaque
 * and translucent browser layers. Only the one-pixel antialiased edge can differ.
 */
async function expectMatchingPromptInk(
  page: Page,
  originalScreenshot: Buffer,
  pinnedText: Locator,
) {
  const pinnedScreenshot = await pinnedText.screenshot({ animations: "disabled" });
  const textColor = await pinnedText.evaluate((node) => {
    for (let parent: Element | null = node; parent; parent = parent.parentElement) {
      if (getComputedStyle(parent).opacity !== "1") throw new Error("Pinned foreground is dimmed");
    }
    return getComputedStyle(node).color;
  });
  const ink = await page.evaluate(
    async ({ source, pinned, color }) => {
      const foreground = color.match(/\d+/g)!.slice(0, 3).map(Number);
      async function decodeInk(base64: string) {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, image.width, image.height).data;
        const background = Array.from(pixels.slice(0, 3));
        const foregroundBrightness = foreground.reduce((sum, channel) => sum + channel, 0) / 3;
        const backgroundBrightness = background.reduce((sum, channel) => sum + channel, 0) / 3;
        const threshold =
          foregroundBrightness + (backgroundBrightness - foregroundBrightness) * 0.35;
        const darkText = foregroundBrightness < backgroundBrightness;
        const mask: boolean[] = [];
        for (let index = 0; index < pixels.length; index += 4) {
          const brightness = (pixels[index]! + pixels[index + 1]! + pixels[index + 2]!) / 3;
          mask.push(darkText ? brightness < threshold : brightness > threshold);
        }
        return {
          width: image.width,
          height: image.height,
          mask,
          count: mask.filter(Boolean).length,
        };
      }
      const original = await decodeInk(source);
      const copy = await decodeInk(pinned);
      /** LCD color fringing and grayscale smoothing can choose neighboring edge pixels. */
      function unmatchedPixels(from: typeof original, to: typeof original) {
        return from.mask.filter((painted, index) => {
          if (!painted) return false;
          const x = index % from.width;
          const y = Math.floor(index / from.width);
          for (let dy = -1; dy <= 1; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
              if (
                x + dx >= 0 &&
                x + dx < to.width &&
                y + dy >= 0 &&
                y + dy < to.height &&
                to.mask[(y + dy) * to.width + x + dx]
              )
                return false;
            }
          }
          return true;
        }).length;
      }
      return {
        original: { width: original.width, height: original.height, count: original.count },
        copy: { width: copy.width, height: copy.height, count: copy.count },
        missing: unmatchedPixels(original, copy),
        added: unmatchedPixels(copy, original),
      };
    },
    {
      source: originalScreenshot.toString("base64"),
      pinned: pinnedScreenshot.toString("base64"),
      color: textColor,
    },
  );
  expect(ink.original.count).toBeGreaterThan(0);
  expect(ink.copy.width).toBe(ink.original.width);
  expect(ink.copy.height).toBe(ink.original.height);
  expect(ink.missing).toBe(0);
  expect(ink.added).toBe(0);
  expect(ink.copy.count / ink.original.count).toBeGreaterThan(0.9);
  expect(ink.copy.count / ink.original.count).toBeLessThan(1.1);
}

/** Compare painted bubble pixels at fine forward/reverse offsets around the pin threshold. */
async function expectSinglePaintedPromptHandoff(page: Page, prompt: string, width: number) {
  const timeline = page.getByTestId("agent-chat-scroll");
  const original = timeline.getByTestId("user-message").filter({ hasText: prompt });
  const source = original.getByTestId("user-message-bubble");
  const sticky = page.getByTestId("sticky-user-message");
  const targetPinned = sticky.filter({ hasText: prompt });
  // Arrows land pinned. Reveal this original before taking its painted baseline,
  // so the screenshot cannot capture the copy through the original's masked bounds.
  if (await targetPinned.count()) {
    await targetPinned
      .getByTestId("user-message-content-target")
      .click({ position: { x: 10, y: 4 } });
    await expectTimelinePromptLandedBelowTop(page, prompt);
  }
  await expect(targetPinned).toHaveCount(0);
  await expect(original.getByTestId("user-message-prefix-mask")).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  const viewport = (await timeline.boundingBox())!;
  const sourceBox = (await source.boundingBox())!;
  const originalText = original.getByTestId("user-message-text");
  const originalTextBox = (await originalText.boundingBox())!;
  await timeline.hover();
  const originalPixels = await originalText.screenshot({
    animations: "disabled",
    path: `../../docs/qa-evidence/sticky-user-message/original-body-${width}.png`,
  });
  for (const offset of [6, 3, 1, -1, -3, -6, -12, -24, -12, -3, -1, 1, 3, 6]) {
    const current = (await source.boundingBox())!;
    await page.mouse.wheel(0, current.y - viewport.y - offset);
    await expect
      .poll(async () => (await source.boundingBox())!.y - viewport.y)
      .toBeCloseTo(offset, 0);
    if (offset > 0) {
      await expect(sticky).toHaveCount(0);
      await expect(original.getByTestId("user-message-prefix-mask")).toHaveCount(0);
      continue;
    }
    await expect(sticky).toBeVisible();
    const body = sticky.getByTestId("user-message-bubble");
    const pinned = (await body.boundingBox())!;
    expect(pinned.x).toBeCloseTo(sourceBox.x, 0);
    expect(pinned.width).toBeCloseTo(sourceBox.width, 0);
    expect(pinned.height).toBeCloseTo(sourceBox.height, 0);
    expect(pinned.y).toBeCloseTo(viewport.y, 0);
    await expect(original.getByTestId("user-message-prefix-mask")).toBeVisible();
    await body.screenshot({
      animations: "disabled",
      path: `../../docs/qa-evidence/sticky-user-message/pinned-body-${width}-${offset}.png`,
    });
    const pinnedText = sticky.getByTestId("user-message-text");
    const pinnedTextBox = (await pinnedText.boundingBox())!;
    expect(pinnedTextBox.x).toBeCloseTo(originalTextBox.x, 3);
    expect(pinnedTextBox.y - pinned.y).toBeCloseTo(originalTextBox.y - sourceBox.y, 3);
    expect(pinnedTextBox.width).toBeCloseTo(originalTextBox.width, 3);
    await expectMatchingPromptInk(page, originalPixels, pinnedText);
    await page.screenshot({
      path: `../../docs/qa-evidence/sticky-user-message/single-copy-${width}-${offset}.png`,
    });
  }
}

test("keeps colored pinned disclosure readable before and during hover", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    localStorage.setItem(
      "@paseo:app-settings",
      JSON.stringify({ theme: "dark", accentColor: "blue" }),
    );
  });
  const prompt = `Review this code:\n${"const value = 42;\n".repeat(12)}https://example.test`;
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "accent-pinned-hover",
    title: "Accent pinned prompt",
    initialPrompt: prompt,
  });
  try {
    await agent.client.waitForFinish(agent.agentId, 15_000);
    await agent.client.sendAgentMessage(
      agent.agentId,
      "emit 85 assistant messages before synthetic user message",
    );
    await agent.client.waitForFinish(agent.agentId, 15_000);
    await page.setViewportSize(WIDE_VIEWPORT);
    await openAgentRoute(page, agent);
    await chatOutlineRail(page).getByRole("tab").first().click();
    await expectTimelinePromptLandedBelowTop(page, prompt);
    await scrollTimelinePastPrompt(page, prompt);
    const sticky = page.getByTestId("sticky-user-message");
    const bubble = sticky.getByTestId("user-message-bubble");
    const disclosure = sticky.getByTestId("sticky-user-message-disclosure");
    const label = disclosure.getByText("more…", { exact: true });
    await expect(bubble).toHaveCSS("background-color", "rgb(147, 197, 253)");
    await expect(sticky.getByTestId("user-message-text")).toHaveCSS("color", "rgb(24, 24, 27)");
    await page.mouse.move(2, 2);
    await expect(label).toHaveCSS("color", "rgb(24, 24, 27)");
    await disclosure.hover();
    await expect(label).toHaveCSS("color", "rgb(24, 24, 27)");
    await expect(disclosure).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await page.screenshot({
      path: testInfo.outputPath("accent-pinned-more-hover.png"),
      fullPage: true,
    });
    await disclosure.click();
    await expect(disclosure).toHaveText("less…");
    await expect(disclosure.getByText("less…", { exact: true })).toHaveCSS(
      "color",
      "rgb(24, 24, 27)",
    );
  } finally {
    await agent.cleanup();
  }
});
