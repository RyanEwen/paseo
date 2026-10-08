import { describe, expect, it } from "vitest";
import {
  buildWindowsAgentToast,
  openWindowsAgentNotification,
  shouldRetainWindowsNotification,
  pruneRemovedWindowsNotifications,
} from "./windows-agent-notification.js";

describe("Windows chat notification activation", () => {
  it("carries the chat target independently of the notification object and escapes its display content", () => {
    const toast = buildWindowsAgentToast({
      notificationId: "notice-1",
      title: 'Agent <ready> & "waiting"',
      body: "Ryan's chat",
      data: { serverId: "host/one", agentId: "chat one", workspaceId: "workspace-one" },
      iconPath: "C:\\Paseo & tools\\icon.png",
      silent: true,
    });
    expect(toast).toBe(
      '<toast launch="type=click&amp;tag=notice-1&amp;paseoAgent=paseo%3A%2F%2Fh%2Fhost%252Fone%2Fagent%2Fchat%2520one" activationType="foreground"><visual><binding template="ToastGeneric"><text>Agent &lt;ready&gt; &amp; &quot;waiting&quot;</text><text>Ryan&apos;s chat</text><image placement="appLogoOverride" hint-crop="none" src="C:\\Paseo &amp; tools\\icon.png"/></binding></visual><audio silent="true"/></toast>',
    );

    const links: string[] = [];
    openWindowsAgentNotification(
      {
        type: "click",
        arguments:
          "type=click&tag=notice-1&paseoAgent=paseo%3A%2F%2Fh%2Fhost%252Fone%2Fagent%2Fchat%2520one",
      },
      (url) => links.push(url),
    );
    expect(links).toEqual(["paseo://h/host%2Fone/agent/chat%20one"]);
  });

  it("keeps sound enabled and supports notifications with no body, icon, or workspace", () => {
    expect(
      buildWindowsAgentToast({
        notificationId: "notice-1",
        title: "Finished",
        body: undefined,
        data: { serverId: "host", agentId: "chat" },
        iconPath: null,
        silent: false,
      }),
    ).toBe(
      '<toast launch="type=click&amp;tag=notice-1&amp;paseoAgent=paseo%3A%2F%2Fh%2Fhost%2Fagent%2Fchat" activationType="foreground"><visual><binding template="ToastGeneric"><text>Finished</text></binding></visual></toast>',
    );
  });

  it("keeps timed-out banners alive for Notification Center clicks", () => {
    expect(shouldRetainWindowsNotification("timedOut")).toBe(true);
    expect(shouldRetainWindowsNotification("userCanceled")).toBe(false);
    expect(shouldRetainWindowsNotification("applicationHidden")).toBe(false);
    expect(shouldRetainWindowsNotification(undefined)).toBe(false);
  });

  it("releases removed Center entries while retaining those Windows still delivers", async () => {
    const clicked = { id: "clicked" };
    const pending = { id: "pending" };
    const notifications = new Set([clicked, pending]);
    const errors: unknown[] = [];
    await pruneRemovedWindowsNotifications({
      notifications,
      getDeliveredIds: async () => new Set(["pending"]),
      release: (notification) => notifications.delete(notification),
      onHistoryError: (error) => errors.push(error),
    });
    expect([...notifications]).toEqual([pending]);
    expect(errors).toEqual([]);
  });

  it("retains Center entries when history cannot be read", async () => {
    const pending = { id: "pending" };
    const notifications = new Set([pending]);
    const historyError = new Error("Windows history unavailable");
    const errors: unknown[] = [];
    await pruneRemovedWindowsNotifications({
      notifications,
      getDeliveredIds: async () => {
        throw historyError;
      },
      release: (notification) => notifications.delete(notification),
      onHistoryError: (error) => errors.push(error),
    });
    expect([...notifications]).toEqual([pending]);
    expect(errors).toEqual([historyError]);
  });

  it("does not collect a banner that expires after the history request starts", async () => {
    const earlier = { id: "earlier" };
    const later = { id: "later" };
    const notifications = new Set([earlier]);
    const errors: unknown[] = [];
    await pruneRemovedWindowsNotifications({
      notifications,
      getDeliveredIds: async () => {
        notifications.add(later);
        return new Set<string>();
      },
      release: (notification) => notifications.delete(notification),
      onHistoryError: (error) => errors.push(error),
    });
    expect([...notifications]).toEqual([later]);
    expect(errors).toEqual([]);
  });

  it("strips invalid XML controls while preserving Unicode and line breaks", () => {
    expect(
      buildWindowsAgentToast({
        notificationId: "notice-1",
        title: "Ready\u0000\u001b",
        body: "Chat 😀\nLine two\uD800",
        data: { serverId: "host", agentId: "chat" },
        iconPath: null,
        silent: false,
      }),
    ).toBe(
      '<toast launch="type=click&amp;tag=notice-1&amp;paseoAgent=paseo%3A%2F%2Fh%2Fhost%2Fagent%2Fchat" activationType="foreground"><visual><binding template="ToastGeneric"><text>Ready</text><text>Chat 😀\nLine two</text></binding></visual></toast>',
    );
  });

  it("does not turn a terminal or permission-test notification into a chat notification", () => {
    for (const data of [
      undefined,
      { serverId: "host", terminalId: "terminal" },
      { serverId: "host", agentId: " " },
    ]) {
      expect(
        buildWindowsAgentToast({
          notificationId: "notice-1",
          title: "Test",
          body: undefined,
          data,
          iconPath: null,
          silent: false,
        }),
      ).toBe(null);
    }
    const links: string[] = [];
    for (const input of [
      { type: "click", arguments: "" },
      { type: "click", arguments: "https://example.com" },
      {
        type: "reply",
        arguments: "type=click&tag=notice-1&paseoAgent=paseo%3A%2F%2Fh%2Fhost%2Fagent%2Fchat",
      },
    ]) {
      openWindowsAgentNotification(input, (url) => links.push(url));
    }
    expect(links).toEqual([]);
  });
});
