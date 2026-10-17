import * as Notifications from "expo-notifications";
import { createSeenAgentNotifications } from "./seen-agent";

export const seenAgentNotifications = createSeenAgentNotifications({
  async list() {
    const notifications = await Notifications.getPresentedNotificationsAsync();
    return notifications.map((notification) => ({
      identifier: notification.request.identifier,
      data: notification.request.content.data,
    }));
  },
  dismiss: Notifications.dismissNotificationAsync,
  async setViewedTarget() {},
  onError: (error) =>
    console.warn("[notifications] Failed to dismiss viewed chat notification", error),
});

Notifications.addNotificationReceivedListener((notification) => {
  void seenAgentNotifications.dismissReceived({
    identifier: notification.request.identifier,
    data: notification.request.content.data,
  });
});
