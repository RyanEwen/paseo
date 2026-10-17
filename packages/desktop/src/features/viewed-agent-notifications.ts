import type { AgentDeepLinkTarget } from "@getpaseo/protocol/agent-deep-link";
import { parseAgentDeepLink } from "@getpaseo/protocol/agent-deep-link";

export interface DeliveredAgentToast {
  tag: string;
  group: string;
  arguments: string;
}
export interface KnownAgentNotification {
  target: AgentDeepLinkTarget;
  close(): void;
}
export interface ViewedAgentNotificationInput {
  revision: number;
  target: AgentDeepLinkTarget | null;
}
interface ViewedAgentNotificationAdapter {
  canView(windowId: number): boolean;
  known(): Iterable<KnownAgentNotification>;
  list(): Promise<DeliveredAgentToast[]>;
  remove(toasts: DeliveredAgentToast[]): Promise<void>;
}

function sameAgent(a: AgentDeepLinkTarget, b: AgentDeepLinkTarget): boolean {
  return a.serverId === b.serverId && a.agentId === b.agentId;
}

/** Match only chat launches emitted by Paseo; terminal and unrelated toast payloads are excluded. */
export function toastTargetsAgent(
  toast: DeliveredAgentToast,
  target: AgentDeepLinkTarget,
): boolean {
  const link = new URLSearchParams(toast.arguments).get("paseoAgent");
  const parsed = link ? parseAgentDeepLink(link) : null;
  return parsed !== null && sameAgent(parsed, target);
}

/** Fence each window's acknowledged target with both its renderer revision and current OS focus. */
export function createViewedAgentNotifications(adapter: ViewedAgentNotificationAdapter) {
  const windows = new Map<number, ViewedAgentNotificationInput>();

  function isViewed(target: AgentDeepLinkTarget): boolean {
    return [...windows].some(
      ([id, view]) => view.target !== null && adapter.canView(id) && sameAgent(view.target, target),
    );
  }

  async function setView(windowId: number, view: ViewedAgentNotificationInput): Promise<void> {
    const previous = windows.get(windowId);
    if (previous && previous.revision >= view.revision) return;
    windows.set(windowId, view);
    const target = view.target;
    if (!target || !adapter.canView(windowId)) return;
    const isCurrent = () => windows.get(windowId) === view && adapter.canView(windowId);

    for (const notification of adapter.known()) {
      if (!isCurrent()) return;
      if (sameAgent(notification.target, target)) notification.close();
    }

    const history = await adapter.list();
    if (!isCurrent()) return;
    const matching = history.filter((toast) => toast.tag && toastTargetsAgent(toast, target));
    if (matching.length > 0) await adapter.remove(matching);
  }

  return { isViewed, setView, removeWindow: (id: number) => windows.delete(id) };
}
