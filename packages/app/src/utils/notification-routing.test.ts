import type { AgentDeepLinkTarget } from "@getpaseo/protocol/agent-deep-link";
import {
  createSeenAgentNotifications,
  isAgentNotificationViewVisible,
  type PresentedAgentNotification,
} from "@/notifications/seen-agent";
import { describe, expect, it } from "vitest";

import { buildNotificationRoute, resolveNotificationTarget } from "./notification-routing";

describe("resolveNotificationTarget", () => {
  it("extracts non-empty server and agent ids", () => {
    expect(
      resolveNotificationTarget({
        serverId: " server-123 ",
        agentId: " agent-456 ",
      }),
    ).toEqual({
      serverId: "server-123",
      agentId: "agent-456",
      workspaceId: null,
      terminalId: null,
    });
  });

  it("returns null for missing/empty ids", () => {
    expect(resolveNotificationTarget({ serverId: "", agentId: "   " })).toEqual({
      serverId: null,
      agentId: null,
      workspaceId: null,
      terminalId: null,
    });
    expect(resolveNotificationTarget(undefined)).toEqual({
      serverId: null,
      agentId: null,
      workspaceId: null,
      terminalId: null,
    });
  });

  it("does not treat cwd as a workspace id alias", () => {
    expect(
      resolveNotificationTarget({
        serverId: "srv-1",
        agentId: "agent-1",
        cwd: "/tmp/repo",
      }),
    ).toEqual({
      serverId: "srv-1",
      agentId: "agent-1",
      workspaceId: null,
      terminalId: null,
    });
  });
});

describe("buildNotificationRoute", () => {
  it("routes to the agent path when workspace id is present", () => {
    expect(
      buildNotificationRoute({
        serverId: "srv-1",
        agentId: "agent-1",
        workspaceId: "ws-main",
      }),
    ).toBe("/h/srv-1/workspace/ws-main?open=agent%3Aagent-1");
  });

  it("resolves the named agent when the notification has no workspace id", () => {
    expect(buildNotificationRoute({ serverId: "srv-1", agentId: "agent-1" })).toBe(
      "/h/srv-1/agent/agent-1",
    );
  });

  it("routes to the workspace terminal tab when workspace and terminal ids are present", () => {
    expect(
      buildNotificationRoute({
        serverId: "srv-1",
        workspaceId: "ws-main",
        terminalId: "term-1",
      }),
    ).toBe("/h/srv-1/workspace/ws-main?open=terminal%3Aterm-1");
  });

  it("falls back to host root for a terminal without a workspace id", () => {
    expect(
      buildNotificationRoute({
        serverId: "srv-1",
        terminalId: "term-1",
        cwd: "/tmp/repo",
      }),
    ).toBe("/h/srv-1");
  });

  it("falls back to host root when only serverId is present", () => {
    expect(buildNotificationRoute({ serverId: "srv-only" })).toBe("/h/srv-only");
  });

  it("falls back to root when no server id is present", () => {
    expect(buildNotificationRoute({ agentId: "agent-legacy" })).toBe("/");
    expect(buildNotificationRoute(undefined)).toBe("/");
  });

  it("encodes path segments", () => {
    expect(
      buildNotificationRoute({
        serverId: "srv/with/slash",
        workspaceId: "workspace-1",
        agentId: "agent with space",
      }),
    ).toBe("/h/srv%2Fwith%2Fslash/workspace/workspace-1?open=agent%3Aagent%20with%20space");
  });
});

// The notification adapter represents a real platform tray, not app component internals.

describe("seen chat notification dismissal", () => {
  function platformTray() {
    const removed: string[] = [];
    const views: Array<{ target: AgentDeepLinkTarget | null; revision: number }> = [];
    let list: () => Promise<PresentedAgentNotification[]> = async () => [];
    const errors: unknown[] = [];
    const seen = createSeenAgentNotifications({
      list: () => list(),
      dismiss: async (id) => {
        removed.push(id);
      },
      setViewedTarget: async (target, revision) => {
        views.push({ target, revision });
      },
      onError: (error) => errors.push(error),
    });
    return {
      seen,
      removed,
      views,
      errors,
      setList: (next: typeof list) => {
        list = next;
      },
    };
  }

  it("clears only the viewed host and chat from delivered tray history", async () => {
    const tray = platformTray();
    tray.setList(async () => [
      { identifier: "seen", data: { serverId: "host", agentId: "chat", workspaceId: "workspace" } },
      { identifier: "other-chat", data: { serverId: "host", agentId: "other" } },
      { identifier: "other-host", data: { serverId: "other", agentId: "chat" } },
      { identifier: "workspace-only", data: { serverId: "host", workspaceId: "workspace" } },
    ]);
    tray.seen.view({ target: { serverId: "host", agentId: "chat" }, isVisible: () => true });
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(tray.removed).toEqual(["seen"]);
  });

  it("rejects a history read that completes after rapid tab changes", async () => {
    const tray = platformTray();
    let resolveHistory: (value: PresentedAgentNotification[]) => void = () => {};
    tray.setList(
      () =>
        new Promise((resolve) => {
          resolveHistory = resolve;
        }),
    );
    const releaseOld = tray.seen.view({
      target: { serverId: "host", agentId: "old" },
      isVisible: () => true,
    });
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    tray.setList(async () => []);
    tray.seen.view({ target: { serverId: "host", agentId: "new" }, isVisible: () => true });
    releaseOld();
    resolveHistory([{ identifier: "old-arrival", data: { serverId: "host", agentId: "old" } }]);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(tray.removed).toEqual([]);
    expect(tray.seen.isViewed({ serverId: "host", agentId: "new" })).toBe(true);
  });

  it("clears arrivals while the chat remains visible but not after foreground is lost", async () => {
    const tray = platformTray();
    let visible = true;
    const release = tray.seen.view({
      target: { serverId: "host", agentId: "chat" },
      isVisible: () => visible,
    });
    await tray.seen.dismissReceived({
      identifier: "during-view",
      data: { serverId: "host", agentId: "chat" },
    });
    visible = false;
    await tray.seen.dismissReceived({
      identifier: "after-blur",
      data: { serverId: "host", agentId: "chat" },
    });
    release();
    expect(tray.removed).toEqual(["during-view"]);
    expect(tray.views).toEqual([
      { target: { serverId: "host", agentId: "chat" }, revision: 1 },
      { target: null, revision: 2 },
    ]);
  });
  it("refreshes tray cleanup when a compact gesture returns to the chat anchor", async () => {
    const tray = platformTray();
    let settled = false;
    tray.setList(async () => [
      { identifier: "at-rest", data: { serverId: "host", agentId: "chat" } },
    ]);
    const release = tray.seen.view({
      target: { serverId: "host", agentId: "chat" },
      isVisible: () => settled,
    });
    expect(tray.seen.isViewed({ serverId: "host", agentId: "chat" })).toBe(false);
    settled = true;
    await tray.seen.refreshVisibility();
    expect(tray.removed).toEqual(["at-rest"]);
    release();
    expect(tray.seen.isViewed({ serverId: "host", agentId: "chat" })).toBe(false);
  });
});

const visibleChat = {
  foreground: true,
  panelVisible: true,
  focused: true,
  ready: true,
  compact: true,
  centerVisible: true,
  centerRequested: true,
};
describe("notification seen visibility", () => {
  it.each([
    "foreground",
    "panelVisible",
    "focused",
    "ready",
    "centerVisible",
    "centerRequested",
  ] as const)("does not acknowledge a chat without %s", (field) => {
    expect(isAgentNotificationViewVisible({ ...visibleChat, [field]: false })).toBe(false);
  });
  it("acknowledges a settled focused chat on mobile and desktop", () => {
    expect(isAgentNotificationViewVisible(visibleChat)).toBe(true);
    expect(
      isAgentNotificationViewVisible({
        ...visibleChat,
        compact: false,
        centerVisible: false,
        centerRequested: false,
      }),
    ).toBe(true);
  });
});
