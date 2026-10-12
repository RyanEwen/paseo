import type { Page } from "@playwright/test";
import { seedMockAgentWorkspace } from "../support/helpers/mock-agent";
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

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
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
      for (let index = agent.prompts.length - 2; index >= 0; index -= 1) {
        const original = page
          .getByTestId("agent-chat-scroll")
          .getByTestId("user-message")
          .filter({ hasText: agent.prompts[index + 1]! });
        if (await sticky.count()) await previous.click();
        else await original.getByTestId("user-message-previous").click();
        const target = page
          .getByTestId("agent-chat-scroll")
          .getByTestId("user-message")
          .filter({ hasText: agent.prompts[index]! });
        await expect(target).toBeInViewport();
        await expect(sticky).toHaveCount(0);
        // The newest turns cannot always align at the top because the viewport clamps.
        // Older turns leave enough later content to scroll their original bubble offscreen.
        if (index < agent.prompts.length - 8) {
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
              .toBeGreaterThan(0);
            await expect
              .poll(() => sticky.evaluate((element) => Number(getComputedStyle(element).opacity)))
              .toBeLessThan(1);
            const bubble = await sticky.getByTestId("user-message").boundingBox();
            const controls = await sticky.getByTestId("sticky-user-message-controls").boundingBox();
            expect(controls!.y).toBeGreaterThanOrEqual(bubble!.y + bubble!.height - 1);
            await page.screenshot({
              path: `../../docs/qa-evidence/sticky-user-message/handoff-${viewport.width}.png`,
            });
            await page.mouse.wheel(0, -40);
            await expect(sticky).toHaveCount(0);
          }
          await scrollTimelinePastPrompt(page, agent.prompts[index]!);
        }
      }
      await expect(previous).toBeDisabled();
      await next.click();
      await expectTimelinePromptLandedBelowTop(page, agent.prompts[1]!);
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
    await page
      .getByTestId("agent-chat-scroll")
      .getByTestId("user-message")
      .filter({ hasText: agent.newestPrompt })
      .getByTestId("user-message-previous")
      .click();
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
