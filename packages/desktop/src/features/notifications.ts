import { z } from "zod";
import { desktopDistribution } from "../distribution.js";
import {
  createViewedAgentNotifications,
  type KnownAgentNotification,
} from "./viewed-agent-notifications.js";
import { createWindowsToastHistory } from "./windows-toast-history.js";
import path from "node:path";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { app, BrowserWindow, Notification, ipcMain, nativeImage } from "electron";
import { getDesktopSettingsStore } from "../settings/desktop-settings-electron.js";
import {
  buildWindowsAgentToast,
  buildWindowsAgentNotificationArguments,
  createWindowsAgentNotificationOpener,
  shouldRetainWindowsNotification,
} from "./windows-agent-notification.js";

interface NotificationInput {
  title?: unknown;
  body?: unknown;
  data?: unknown;
}

interface NotificationClickPayload {
  data?: Record<string, unknown>;
}

const activeNotifications = new Set<Notification>();
const agentNotifications = new Map<Notification, KnownAgentNotification>();

function releaseNotification(notification: Notification): void {
  activeNotifications.delete(notification);
  agentNotifications.delete(notification);
}

function toTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function getNotificationIcon(): { image: Electron.NativeImage; path: string } | null {
  const candidates = [
    path.resolve(__dirname, "../assets/icon.png"),
    path.resolve(__dirname, "../assets/64x64.png"),
    path.resolve(__dirname, "../assets/128x128.png"),
  ];

  for (const iconPath of candidates) {
    if (!existsSync(iconPath)) {
      continue;
    }
    const icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) {
      return { image: icon, path: iconPath };
    }
  }

  return null;
}

function focusSenderWindow(sender: Electron.WebContents): BrowserWindow | null {
  const win = BrowserWindow.fromWebContents(sender) ?? BrowserWindow.getAllWindows()[0] ?? null;
  if (!win || win.isDestroyed()) {
    return null;
  }
  win.show();
  if (win.isMinimized()) {
    win.restore();
  }
  win.focus();
  return win;
}

/**
 * macOS requires a notification to have been shown at least once before
 * the app appears in System Preferences > Notifications. We fire a
 * silent no-op notification during startup to ensure registration.
 */
export function ensureNotificationCenterRegistration(): void {
  if (process.platform !== "darwin" || !Notification.isSupported()) {
    return;
  }

  const probe = new Notification({ title: app.name, silent: true });
  probe.on("show", () => probe.close());
  setTimeout(() => probe.close(), 2_000);
  probe.show();
}

export function registerNotificationHandlers(openAgentLink: (url: string) => void): void {
  const history = createWindowsToastHistory({
    executable: process.execPath,
    isPackagedFork: app.isPackaged && desktopDistribution.isPreview,
  });
  const viewed = createViewedAgentNotifications({
    canView(windowId) {
      const win = BrowserWindow.getAllWindows().find(
        (candidate) => candidate.webContents.id === windowId,
      );
      return Boolean(
        win && !win.isDestroyed() && win.isVisible() && !win.isMinimized() && win.isFocused(),
      );
    },
    known: () => agentNotifications.values(),
    list: () => (process.platform === "win32" ? history.list() : Promise.resolve([])),
    remove: (toasts) => history.remove(toasts),
  });
  const targetSchema = z.object({
    serverId: z.string().trim().min(1),
    agentId: z.string().trim().min(1),
  });
  const viewSchema = z.object({
    revision: z.number().int().nonnegative(),
    target: targetSchema.nullable(),
  });
  ipcMain.handle("paseo:notification:setViewedAgent", async (event, raw: unknown) => {
    const view = viewSchema.parse(raw);
    await viewed.setView(event.sender.id, view);
  });
  app.on("web-contents-created", (_event, contents) => {
    const id = contents.id;
    contents.on("did-start-navigation", (_navigationEvent, _url, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace) viewed.removeWindow(id);
    });
    contents.once("destroyed", () => viewed.removeWindow(id));
  });
  const openWindowsNotification = createWindowsAgentNotificationOpener(openAgentLink);
  if (process.platform === "win32") {
    // This also receives clicks after the original Notification was collected
    // or the app restarted. The existing agent-link owner queues cold-start hops.
    Notification.handleActivation((details) => {
      openWindowsNotification(details);
    });
  }

  ipcMain.handle("paseo:notification:isSupported", () => {
    return Notification.isSupported();
  });

  ipcMain.handle("paseo:notification:send", async (event, rawInput?: NotificationInput) => {
    if (!Notification.isSupported()) {
      return false;
    }

    const title = toTrimmedString(rawInput?.title);
    if (!title) {
      return false;
    }

    const body = toTrimmedString(rawInput?.body) ?? undefined;
    const data = toRecord(rawInput?.data);
    const parsedTarget = targetSchema.safeParse(data);
    const target = parsedTarget.success ? parsedTarget.data : null;
    const notificationId = randomUUID();
    const icon = getNotificationIcon();
    const settings = await getDesktopSettingsStore().get();
    if (target && viewed.isViewed(target)) return true;
    const silent = !settings.notifications.playSound;
    const toastXml =
      process.platform === "win32"
        ? buildWindowsAgentToast({
            notificationId,
            title,
            body,
            data,
            iconPath: icon?.path ?? null,
            silent,
          })
        : null;
    const notification = new Notification({
      id: notificationId,
      title,
      ...(body ? { body } : {}),
      ...(icon ? { icon: icon.image } : {}),
      ...(toastXml ? { toastXml } : {}),
      silent,
    });

    activeNotifications.add(notification);
    if (target) {
      let shown = false;
      let dismissWhenShown = false;
      const dismissKnown = () => {
        // A pending native Show cannot be canceled by closing the JS wrapper.
        // Preserve it until its show callback can remove this exact toast.
        if (!shown) {
          dismissWhenShown = true;
          return;
        }
        notification.close();
        releaseNotification(notification);
      };
      agentNotifications.set(notification, { target, close: dismissKnown });
      notification.on("show", () => {
        shown = true;
        if (dismissWhenShown || viewed.isViewed(target)) {
          dismissKnown();
          if (process.platform === "win32") {
            void history
              .remove([{ tag: notificationId, group: "Notifications", arguments: "" }])
              .catch((error) =>
                console.warn("[notifications] Failed to remove viewed toast from history", error),
              );
          }
        }
      });
    }

    notification.on("click", () => {
      // Electron 44 can report a foreground body tap only on the instance.
      // Route it through the same opener used by durable COM activations.
      if (toastXml) {
        const launch = buildWindowsAgentNotificationArguments({ notificationId, data });
        if (launch) {
          openWindowsNotification({ type: "click", arguments: launch });
        }
        releaseNotification(notification);
        return;
      }
      const win = focusSenderWindow(event.sender);
      if (win && data && Object.keys(data).length > 0) {
        const payload: NotificationClickPayload = { data };
        win.webContents.send("paseo:event:notification-click", payload);
      }
      releaseNotification(notification);
    });

    notification.on("close", (closeEvent) => {
      if (process.platform === "win32" && shouldRetainWindowsNotification(closeEvent.reason)) {
        // getHistory() is macOS-only and returns an empty list on Windows.
        // Keep this reference so foreground Center taps retain their listener.
        return;
      }
      releaseNotification(notification);
    });

    notification.on("failed", () => {
      releaseNotification(notification);
    });

    notification.show();
    return true;
  });
}
