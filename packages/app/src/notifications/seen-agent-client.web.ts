import { getDesktopHost } from "@/desktop/host";
import { createSeenAgentNotifications } from "./seen-agent";
import { listWebNotifications, dismissWebNotification } from "./web-notification-registry";

export const seenAgentNotifications = createSeenAgentNotifications({
  list: listWebNotifications,
  dismiss: dismissWebNotification,
  async setViewedTarget(target, revision) {
    await getDesktopHost()?.notification?.setViewedAgent?.({ target, revision });
  },
  onError: (error) =>
    console.warn("[notifications] Failed to dismiss viewed chat notification", error),
});
