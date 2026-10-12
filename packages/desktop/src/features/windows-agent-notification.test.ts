import { buildAgentDeepLink } from "@getpaseo/protocol/agent-deep-link";
import {
  createViewedAgentNotifications,
  type DeliveredAgentToast,
} from "./viewed-agent-notifications.js";
import { describe, expect, it } from "vitest";
import {
  buildWindowsAgentToast,
  buildWindowsAgentNotificationArguments,
  openWindowsAgentNotification,
  shouldRetainWindowsNotification,
  createWindowsAgentNotificationOpener,
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

  it("opens a foreground instance click and a durable activation only once, in either order", () => {
    for (const callbackOrder of [
      ["instance", "activation"],
      ["activation", "instance"],
    ]) {
      const links: string[] = [];
      const open = createWindowsAgentNotificationOpener((url) => links.push(url));
      const activation = {
        type: "click",
        arguments: "type=click&tag=notice-1&paseoAgent=paseo%3A%2F%2Fh%2Fhost%2Fagent%2Fchat",
      };
      const argumentsFromInstance = buildWindowsAgentNotificationArguments({
        notificationId: "notice-1",
        data: { serverId: "host", agentId: "chat" },
      });
      expect(argumentsFromInstance).toBe(activation.arguments);
      if (argumentsFromInstance === null) {
        throw new Error("Valid instance target did not produce activation arguments");
      }
      const instanceClick = { type: "click", arguments: argumentsFromInstance };
      for (const callback of callbackOrder) {
        open(callback === "instance" ? instanceClick : activation);
      }
      expect(links).toEqual(["paseo://h/host/agent/chat"]);
    }
  });

  it("opens instance-only and restart activations, including distinct notices for the same chat", () => {
    const links: string[] = [];
    const open = createWindowsAgentNotificationOpener((url) => links.push(url));
    for (const tag of ["foreground", "notification-center", "after-restart"]) {
      open({
        type: "click",
        arguments: `type=click&tag=${tag}&paseoAgent=paseo%3A%2F%2Fh%2Fhost%2Fagent%2Fchat`,
      });
    }
    expect(links).toEqual([
      "paseo://h/host/agent/chat",
      "paseo://h/host/agent/chat",
      "paseo://h/host/agent/chat",
    ]);
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

describe("viewed chat notification history", () => {
  function historyPlatform() {
    let foreground = true;
    let list: () => Promise<DeliveredAgentToast[]> = async () => [];
    const removed: string[] = [];
    const closed: string[] = [];
    const controller = createViewedAgentNotifications({
      canView: (id) => id === 1 && foreground,
      known: () => [
        { target: { serverId: "host", agentId: "chat" }, close: () => closed.push("chat") },
        {
          target: { serverId: "other-host", agentId: "chat" },
          close: () => closed.push("other-host"),
        },
      ],
      list: () => list(),
      remove: async (entries) => {
        removed.push(...entries.map((entry) => entry.tag));
      },
    });
    return {
      controller,
      removed,
      closed,
      setForeground: (value: boolean) => {
        foreground = value;
      },
      setList: (next: typeof list) => {
        list = next;
      },
    };
  }
  function toast(tag: string, host: string, chat: string): DeliveredAgentToast {
    return {
      tag,
      group: "Notifications",
      arguments: new URLSearchParams({
        paseoAgent: buildAgentDeepLink({ serverId: host, agentId: chat }),
      }).toString(),
    };
  }

  it("removes only this host's viewed chat, including historical toasts with no live object", async () => {
    const platform = historyPlatform();
    platform.setList(async () => [
      toast("historical", "host", "chat"),
      toast("other-host", "other-host", "chat"),
      toast("other-chat", "host", "other-chat"),
    ]);
    await platform.controller.setView(1, {
      revision: 1,
      target: { serverId: "host", agentId: "chat" },
    });
    expect(platform.closed).toEqual(["chat"]);
    expect(platform.removed).toEqual(["historical"]);
  });

  it("rejects stale renderer revisions and acknowledgements from another window", async () => {
    const platform = historyPlatform();
    await platform.controller.setView(1, {
      revision: 2,
      target: { serverId: "host", agentId: "other" },
    });
    await platform.controller.setView(1, {
      revision: 1,
      target: { serverId: "host", agentId: "chat" },
    });
    await platform.controller.setView(2, {
      revision: 3,
      target: { serverId: "host", agentId: "chat" },
    });
    expect(platform.controller.isViewed({ serverId: "host", agentId: "chat" })).toBe(false);
    expect(platform.closed).toEqual([]);
  });

  it("does not dismiss history returned after the window is minimized or hidden", async () => {
    const platform = historyPlatform();
    platform.setList(async () => {
      platform.setForeground(false);
      return [toast("late", "host", "chat")];
    });
    await platform.controller.setView(1, {
      revision: 1,
      target: { serverId: "host", agentId: "chat" },
    });
    expect(platform.removed).toEqual([]);
    expect(platform.controller.isViewed({ serverId: "host", agentId: "chat" })).toBe(false);
  });
  it("accepts a fresh renderer revision after that window reloads", async () => {
    const platform = historyPlatform();
    await platform.controller.setView(1, {
      revision: 12,
      target: { serverId: "host", agentId: "other" },
    });
    platform.controller.removeWindow(1);
    await platform.controller.setView(1, {
      revision: 1,
      target: { serverId: "host", agentId: "chat" },
    });
    expect(platform.closed).toEqual(["chat"]);
  });
  it("rejects a history snapshot returned after switching to a different chat", async () => {
    const platform = historyPlatform();
    let deliverHistory: (entries: DeliveredAgentToast[]) => void = () => {};
    platform.setList(
      () =>
        new Promise((resolve) => {
          deliverHistory = resolve;
        }),
    );
    const oldView = platform.controller.setView(1, {
      revision: 1,
      target: { serverId: "host", agentId: "chat" },
    });
    platform.setList(async () => []);
    await platform.controller.setView(1, {
      revision: 2,
      target: { serverId: "host", agentId: "new-chat" },
    });
    deliverHistory([toast("old", "host", "chat"), toast("new", "host", "new-chat")]);
    await oldView;
    expect(platform.removed).toEqual([]);
    expect(platform.controller.isViewed({ serverId: "host", agentId: "new-chat" })).toBe(true);
  });
});
