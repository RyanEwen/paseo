import type { ToolCallTimelineItem } from "@getpaseo/protocol/agent-types";
import {
  buildToolActivityScene,
  ACTIVITY_READ_COMMAND,
  ACTIVITY_READ_OUTPUT,
  ACTIVITY_OPAQUE_COMMAND,
} from "../support/helpers/tool-activity";
import type { Page } from "@playwright/test";
import { test, expect } from "../support/fixtures";
import { expectComposerVisible } from "../support/helpers/composer";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

type WebSocketMessage = string | Buffer;

const COMPACT_VIEWPORT = { width: 390, height: 520 };

function parseSessionMessage(message: WebSocketMessage): Record<string, unknown> | null {
  const raw = typeof message === "string" ? message : message.toString("utf8");
  try {
    const envelope = JSON.parse(raw) as { type?: unknown; message?: unknown };
    return envelope.type === "session" && envelope.message && typeof envelope.message === "object"
      ? (envelope.message as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Identify this agent's stream without holding health or other subscription replies. */
function isAgentStreamFor(message: WebSocketMessage, agentId: string): boolean {
  const session = parseSessionMessage(message);
  const payload = session?.payload as Record<string, unknown> | undefined;
  return session?.type === "agent_stream" && payload?.agentId === agentId;
}

function getToolCallStatus(
  message: WebSocketMessage,
  agentId: string,
): { callId: string; status: string } | null {
  const sessionMessage = parseSessionMessage(message);
  if (sessionMessage?.type !== "agent_stream") {
    return null;
  }
  const payload = sessionMessage.payload as Record<string, unknown> | undefined;
  if (payload?.agentId !== agentId) {
    return null;
  }
  const event = payload.event as Record<string, unknown> | undefined;
  const item = event?.item as Record<string, unknown> | undefined;
  return event?.type === "timeline" &&
    item?.type === "tool_call" &&
    typeof item.callId === "string" &&
    typeof item.status === "string"
    ? { callId: item.callId, status: item.status }
    : null;
}

function cloneToolCallWithId(
  message: WebSocketMessage,
  callId: string,
  sequenceOffset: number,
  replacement?: ToolCallTimelineItem,
): string {
  const raw = typeof message === "string" ? message : message.toString("utf8");
  const envelope = JSON.parse(raw) as {
    message?: {
      payload?: { seq?: number; event?: { item?: { callId?: string } | ToolCallTimelineItem } };
    };
  };
  const payload = envelope.message?.payload;
  const item = payload?.event?.item;
  if (!payload || !item?.callId || typeof payload.seq !== "number") {
    throw new Error("Expected a tool-call session message");
  }
  if (replacement && payload.event) {
    payload.event.item = { ...replacement, callId };
  } else {
    item.callId = callId;
  }
  payload.seq += sequenceOffset;
  return JSON.stringify(envelope);
}

function shiftTimelineSequence(
  message: WebSocketMessage,
  sequenceOffset: number,
): WebSocketMessage {
  if (sequenceOffset === 0) {
    return message;
  }
  const raw = typeof message === "string" ? message : message.toString("utf8");
  try {
    const envelope = JSON.parse(raw) as { message?: { payload?: { seq?: number } } };
    const payload = envelope.message?.payload;
    if (typeof payload?.seq !== "number") {
      return message;
    }
    payload.seq += sequenceOffset;
    return JSON.stringify(envelope);
  } catch {
    return message;
  }
}

async function holdStreamAfterFirstCompletedToolCall(
  page: Page,
  agentId: string,
  scene?: ToolCallTimelineItem[],
) {
  let firstCallId: string | null = null;
  let firstCompletedMessage: WebSocketMessage | null = null;
  let isHolding = false;
  let sequenceOffset = 0;
  const heldMessages: WebSocketMessage[] = [];
  let sendToPage: ((message: WebSocketMessage) => void) | null = null;
  let resolveFirstCompleted!: () => void;
  const firstCompleted = new Promise<void>((resolve) => {
    resolveFirstCompleted = resolve;
  });

  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    sendToPage = (message) => ws.send(message);
    ws.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      if (isHolding) {
        // Semantic scenes freeze this agent's subsequent stream, while health
        // replies and unrelated subscriptions continue through the real socket.
        if (scene && !isAgentStreamFor(message, agentId)) {
          ws.send(message);
          return;
        }
        heldMessages.push(message);
        return;
      }

      const toolCall = getToolCallStatus(message, agentId);
      firstCallId ??= toolCall?.callId ?? null;
      const isFirstCompleted = toolCall?.callId === firstCallId && toolCall?.status === "completed";
      const forwarded =
        firstCallId !== null && isFirstCompleted && scene?.[0]
          ? cloneToolCallWithId(message, firstCallId, 0, scene[0])
          : message;
      ws.send(shiftTimelineSequence(forwarded, sequenceOffset));
      if (toolCall?.callId === firstCallId && toolCall.status === "completed") {
        firstCompletedMessage = message;
        isHolding = true;
        resolveFirstCompleted();
      }
    });
  });

  return {
    waitForFirstCompleted: () => firstCompleted,
    release(extraCompletedCalls = 0) {
      if (scene) extraCompletedCalls = scene.length - 1;
      isHolding = Boolean(scene);
      if (extraCompletedCalls > 0 && (!firstCallId || !firstCompletedMessage)) {
        throw new Error("Expected the first completed tool call before release");
      }
      for (let index = 0; index < extraCompletedCalls; index += 1) {
        sendToPage?.(
          cloneToolCallWithId(
            firstCompletedMessage as WebSocketMessage,
            `${firstCallId}:${index}`,
            index + 1,
            scene?.[index + 1],
          ),
        );
      }
      sequenceOffset = extraCompletedCalls;
      if (scene) return;
      for (const message of heldMessages.splice(0)) {
        sendToPage?.(shiftTimelineSequence(message, sequenceOffset));
      }
    },
  };
}

async function configureOverviewToolCalls(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem(
      "@paseo:app-settings",
      JSON.stringify({ toolCallDetailLevel: "overview" }),
    );
  });
}

async function createOverviewAgent(page: Page, title: string) {
  await configureOverviewToolCalls(page);
  return seedMockAgentWorkspace({
    repoPrefix: "tool-call-overview-sheet-",
    title,
    model: "ten-second-stream",
  });
}

async function openOverviewAgent(
  page: Page,
  agent: Awaited<ReturnType<typeof seedMockAgentWorkspace>>,
): Promise<void> {
  await openAgentRoute(page, {
    workspaceId: agent.workspaceId,
    agentId: agent.agentId,
  });
  await expectComposerVisible(page);
}

function hasScrolledToLatest(root: HTMLElement): boolean {
  for (const node of root.querySelectorAll<HTMLElement>("*")) {
    if (node.scrollHeight <= node.clientHeight) {
      continue;
    }
    const maximumScrollTop = node.scrollHeight - node.clientHeight;
    return maximumScrollTop > 0 && Math.abs(node.scrollTop - maximumScrollTop) <= 1;
  }
  return false;
}

function readScrollMetrics(root: HTMLElement) {
  const badgeElements = root.querySelectorAll<HTMLElement>("[data-testid=tool-call-badge]");
  const latestBadge = badgeElements.item(badgeElements.length - 1);
  const scrollables = [];
  for (const node of root.querySelectorAll<HTMLElement>("*")) {
    if (node.scrollHeight <= node.clientHeight) {
      continue;
    }
    scrollables.push({
      className: node.className,
      clientHeight: node.clientHeight,
      rect: node.getBoundingClientRect().toJSON(),
      scrollHeight: node.scrollHeight,
      scrollTop: node.scrollTop,
      tagName: node.tagName,
    });
  }
  return {
    latestBadgeRect: latestBadge?.getBoundingClientRect().toJSON(),
    rootRect: root.getBoundingClientRect().toJSON(),
    scrollables,
    viewport: { height: window.innerHeight, width: window.innerWidth },
  };
}

test.describe("compact overview tool calls", () => {
  test.use({ viewport: COMPACT_VIEWPORT, hasTouch: true });

  test("keeps a live group sheet current and stacks individual details above it", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const agent = await createOverviewAgent(page, "Compact overview tool calls");

    try {
      const gate = await holdStreamAfterFirstCompletedToolCall(page, agent.agentId);
      await openOverviewAgent(page, agent);
      await agent.client.sendAgentMessage(agent.agentId, "Exercise the overview tool-call sheet.");
      await gate.waitForFirstCompleted();

      const group = page.getByTestId("tool-call-group").first();
      await expect(group).toBeVisible();
      await group.click();

      const sheet = page.getByTestId("tool-call-group-sheet");
      const summary = page.getByTestId("tool-call-group-sheet-summary");
      await expect(sheet).toBeVisible();
      const initialSummary = await summary.innerText();

      gate.release(10);
      const badges = sheet.getByTestId("tool-call-badge");
      await expect.poll(() => badges.count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(11);
      await expect(summary).not.toHaveText(initialSummary);
      await expect.poll(() => sheet.evaluate(hasScrolledToLatest)).toBe(true);
      const scrollMetrics = await sheet.evaluate(readScrollMetrics);
      await testInfo.attach("compact-overview-scroll-metrics", {
        body: JSON.stringify(scrollMetrics, null, 2),
        contentType: "application/json",
      });

      await badges.last().click();
      const detailClose = page.getByTestId("tool-call-sheet-close");
      await expect(detailClose).toBeVisible();

      await detailClose.click();
      await expect(detailClose).toBeHidden();
      await expect(sheet).toBeVisible();

      await testInfo.attach("compact-overview-tool-call-group", {
        body: await page.screenshot(),
        contentType: "image/png",
      });

      await page.getByTestId("tool-call-group-sheet-close").click();
      await expect(sheet).toBeHidden();
      await expect(group).toBeVisible();
    } finally {
      await agent.cleanup();
    }
  });
});

test("keeps overview tool calls inline on desktop", async ({ page }) => {
  test.setTimeout(120_000);
  const agent = await createOverviewAgent(page, "Desktop overview tool calls");

  try {
    await openOverviewAgent(page, agent);
    await agent.client.sendAgentMessage(agent.agentId, "Exercise desktop overview tool calls.");
    const group = page.getByTestId("tool-call-group").first();
    await expect(group).toBeVisible();

    await group.click();
    await expect(page.getByTestId("tool-call-group-sheet")).toHaveCount(0);
    await expect(group.getByTestId("tool-call-badge").first()).toBeVisible();
  } finally {
    await agent.cleanup();
  }
});

for (const compact of [false, true]) {
  test.describe(`readable activity ${compact ? "compact" : "desktop"}`, () => {
    test.use({
      viewport: compact ? { width: 390, height: 844 } : { width: 1280, height: 900 },
      hasTouch: compact,
    });
    for (const enabled of [true, false]) {
      test(`preserves provider details with readable labels ${enabled ? "On by default" : "Off"}`, async ({
        page,
      }, testInfo) => {
        test.setTimeout(120_000);
        await page.addInitScript((descriptive) => {
          const settings = descriptive
            ? { toolCallDetailLevel: "overview" }
            : { toolCallDetailLevel: "overview", paseoPlusPlus: { descriptiveToolCalls: false } };
          localStorage.setItem("@paseo:app-settings", JSON.stringify(settings));
        }, enabled);
        const agent = await seedMockAgentWorkspace({
          repoPrefix: "readable-tool-activity-",
          title: "Readable tool activity",
          model: "ten-second-stream",
        });
        try {
          const scene = buildToolActivityScene(agent.cwd);
          const gate = await holdStreamAfterFirstCompletedToolCall(page, agent.agentId, scene);
          await openOverviewAgent(page, agent);
          await agent.client.sendAgentMessage(agent.agentId, "Show readable provider operations.");
          await gate.waitForFirstCompleted();
          gate.release();
          const group = page.getByTestId("tool-call-group").first();
          await expect(group).toContainText(enabled ? "5 file operations" : "Edited 3 files");
          await expect(group).toContainText(enabled ? "1 file read" : "ran 3 commands");
          const groupButton = group.getByRole("button").first();
          await groupButton.focus();
          await expect(groupButton).toBeFocused();
          await groupButton.press("Enter");
          const root = compact ? page.getByTestId("tool-call-group-sheet") : group;
          await expect(root).toBeVisible();
          const badges = root.getByTestId("tool-call-badge");
          await expect(badges).toHaveCount(scene.length);
          const read = badges.nth(0);
          await expect(read).toContainText(enabled ? "Read" : "Shell");
          await expect(read).toContainText(
            enabled ? "src/notifications.ts" : ACTIVITY_READ_COMMAND,
          );
          await expect(badges.nth(1)).toContainText(enabled ? "Failed: Edit" : "Edit");
          await expect(badges.nth(2)).toContainText(enabled ? "Canceled: Write" : "Write");
          await expect(badges.nth(3)).toContainText(enabled ? "Searched" : "Search");
          await expect(badges.nth(4)).toContainText(enabled ? "Changed files" : "Edit");
          await expect(badges.nth(5)).toContainText(enabled ? "Running script" : "Shell");
          await expect(badges.nth(6)).toContainText(enabled ? "Failed: Run command" : "Shell");
          await testInfo.attach("readable-activity-provider-scene", {
            body: JSON.stringify(scene, null, 2),
            contentType: "application/json",
          });
          await testInfo.attach("readable-activity-labels", {
            body: await page.screenshot(),
            contentType: "image/png",
          });
          await read.getByRole("button").first().click();
          const details = compact ? page.getByTestId("tool-call-sheet") : read;
          await expect(details).toContainText(ACTIVITY_READ_COMMAND);
          await expect(details).toContainText(ACTIVITY_READ_OUTPUT);
          if (compact) await page.getByTestId("tool-call-sheet-close").click();
          else await read.getByRole("button").first().click();
          await badges.nth(4).getByRole("button").first().click();
          const patchDetails = compact ? page.getByTestId("tool-call-sheet") : badges.nth(4);
          for (const diff of [
            "created-file-exact-diff",
            "updated-file-exact-diff",
            "deleted-file-exact-diff",
          ]) {
            await expect(patchDetails).toContainText(diff);
          }
          await testInfo.attach("readable-activity-multi-file-details", {
            body: await page.screenshot(),
            contentType: "image/png",
          });
          if (compact) await page.getByTestId("tool-call-sheet-close").click();
          else await badges.nth(4).getByRole("button").first().click();
          await badges.nth(6).getByRole("button").first().click();
          const opaqueDetails = compact ? page.getByTestId("tool-call-sheet") : badges.nth(6);
          await expect(opaqueDetails).toContainText(ACTIVITY_OPAQUE_COMMAND);
          await expect(opaqueDetails).toContainText("opaque script output");
        } finally {
          await agent.cleanup();
        }
      });
    }
  });
}
