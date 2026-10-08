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
