import type { AgentDeepLinkTarget } from "@getpaseo/protocol/agent-deep-link";
import { resolveNotificationTarget } from "@/utils/notification-routing";

export interface PresentedAgentNotification {
  identifier: string;
  data: Record<string, unknown> | undefined;
}

export interface AgentNotificationAdapter {
  list(): Promise<PresentedAgentNotification[]>;
  dismiss(identifier: string): Promise<void>;
  setViewedTarget(target: AgentDeepLinkTarget | null, revision: number): Promise<void>;
  onError(error: unknown): void;
}

export interface AgentNotificationViewLease {
  target: AgentDeepLinkTarget;
  isVisible(): boolean;
}

export interface AgentNotificationView {
  foreground: boolean;
  panelVisible: boolean;
  focused: boolean;
  ready: boolean;
  compact: boolean;
  centerVisible: boolean;
  centerRequested: boolean;
}

/** Retained content and transitional compact overlays are not acknowledgement surfaces. */
export function isAgentNotificationViewVisible(view: AgentNotificationView): boolean {
  const chatVisible = view.foreground && view.panelVisible && view.focused && view.ready;
  const centerSettled = !view.compact || (view.centerVisible && view.centerRequested);
  return chatVisible && centerSettled;
}

/** Match notification ownership exactly; a workspace alone never acknowledges a chat. */
export function notificationMatchesAgent(
  data: Record<string, unknown> | undefined,
  target: AgentDeepLinkTarget,
): boolean {
  const resolved = resolveNotificationTarget(data);
  return resolved.serverId === target.serverId && resolved.agentId === target.agentId;
}

/** Keep dismissal tied to the latest committed visible chat, including arrivals during history reads. */
export function createSeenAgentNotifications(adapter: AgentNotificationAdapter) {
  let target: AgentDeepLinkTarget | null = null;
  let revision = 0;
  let canView = () => false;
  let lease: symbol | null = null;

  function isViewed(data: Record<string, unknown> | undefined): boolean {
    return target !== null && canView() && notificationMatchesAgent(data, target);
  }

  async function dismissReceived(notification: PresentedAgentNotification): Promise<void> {
    if (!isViewed(notification.data)) return;
    try {
      await adapter.dismiss(notification.identifier);
    } catch (error) {
      adapter.onError(error);
    }
  }

  async function refresh(expectedRevision: number): Promise<void> {
    try {
      const presented = await adapter.list();
      for (const notification of presented) {
        if (expectedRevision !== revision) return;
        await dismissReceived(notification);
      }
    } catch (error) {
      adapter.onError(error);
    }
  }

  /** Motion changes refresh the lease without giving an older tab ownership of its cleanup. */
  async function refreshVisibility(): Promise<void> {
    const expectedRevision = ++revision;
    const visibleTarget = target !== null && canView() ? target : null;
    try {
      await adapter.setViewedTarget(visibleTarget, expectedRevision);
      if (expectedRevision === revision && visibleTarget) await refresh(expectedRevision);
    } catch (error) {
      adapter.onError(error);
    }
  }

  /** Release only this view lease; a retained tab's cleanup cannot cancel the newer focused chat. */
  function view(input: AgentNotificationViewLease): () => void {
    target = input.target;
    canView = input.isVisible;
    const ownLease = Symbol("visible-agent-notification-owner");
    lease = ownLease;
    void refreshVisibility();
    return () => {
      if (lease !== ownLease) return;
      lease = null;
      target = null;
      void refreshVisibility();
    };
  }

  return { view, isViewed, dismissReceived, refreshVisibility };
}
