import type { PresentedAgentNotification } from "./seen-agent";

const notifications = new Map<
  string,
  { notification: PresentedAgentNotification; close(): void }
>();
let nextIdentifier = 0;

/** Retain only this browser session's own notifications; browsers do not expose durable OS history. */
export function retainWebNotification(
  data: Record<string, unknown> | undefined,
  notification: { close(): void; addEventListener(type: "close", listener: () => void): void },
): void {
  const identifier = `web-${++nextIdentifier}`;
  notifications.set(identifier, {
    notification: { identifier, data },
    close: () => notification.close(),
  });
  notification.addEventListener("close", () => notifications.delete(identifier));
}

export async function listWebNotifications(): Promise<PresentedAgentNotification[]> {
  return [...notifications.values()].map((entry) => entry.notification);
}

export async function dismissWebNotification(identifier: string): Promise<void> {
  const entry = notifications.get(identifier);
  if (!entry) return;
  entry.close();
  notifications.delete(identifier);
}
