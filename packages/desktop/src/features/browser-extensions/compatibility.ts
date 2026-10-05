import path from "node:path";
import {
  BrowserWindow,
  ipcMain,
  webContents,
  type Session,
  type ServiceWorkerMain,
  type WebContents,
} from "electron";
import { z } from "zod";
import { matchesExtensionUrl, coversExtensionOrigin } from "./host-patterns.js";
import { registerExtensionNavigation } from "./navigation.js";
import { describeExtensionFrame } from "./frames.js";
import { createExtensionNotifications } from "./notifications.js";
import {
  getActivePaseoBrowserWebContentsForHostWindow,
  getPaseoBrowserWebviewRegistry,
} from "../browser-webviews/index.js";

interface WindowRequest {
  method: string;
  args: unknown[];
  owner: BrowserWindow | null;
}

const CHANNEL = "paseo:extension-compatibility";
const EVENTS = `${CHANNEL}:event`;
const RequestSchema = z.object({ method: z.string(), args: z.array(z.unknown()) });
const ManifestSchema = z.object({
  permissions: z.array(z.string()).default([]),
  host_permissions: z.array(z.string()).default([]),
});
const PermissionSchema = z.object({
  permissions: z.array(z.string()).default([]),
  origins: z.array(z.string()).default([]),
});
const QuerySchema = z.strictObject({
  active: z.boolean().optional(),
  currentWindow: z.boolean().optional(),
  windowId: z.number().optional(),
  url: z.union([z.string(), z.array(z.string())]).optional(),
});

/** Add the browser-owned APIs required by MV3 password-manager startup. Native supported APIs remain Chromium-owned. */
export function registerBrowserExtensionCompatibility(profile: Session) {
  const popupOwners = new Map<number, number>();
  const readyWorkers = new Map<number, Promise<boolean>>();
  const trackedWorkers = new Map<number, ServiceWorkerMain>();
  const workerReadinessResolvers = new Map<number, (ready: boolean) => void>();
  const requestNotification = createExtensionNotifications(emit);
  const registry = getPaseoBrowserWebviewRegistry();

  function extensionForUrl(url: string) {
    const parsed = new URL(url);
    if (parsed.protocol !== "chrome-extension:") {
      throw new Error("Extension API calls require an installed extension origin.");
    }
    const extension = profile.extensions.getExtension(parsed.hostname);
    if (!extension) {
      throw new Error("Extension is no longer enabled.");
    }
    return extension;
  }

  /** Deliver only to extension contexts in the browser profile, never app or remote-page preloads. */
  function emit(id: string, name: string, ...args: unknown[]): void {
    for (const contents of webContents.getAllWebContents()) {
      if (
        contents.session === profile &&
        contents.getURL().startsWith(`chrome-extension://${id}/`)
      ) {
        contents.send(EVENTS, name, args);
      }
    }
    for (const worker of trackedWorkers.values()) {
      if (worker.scope.startsWith(`chrome-extension://${id}/`) && !worker.isDestroyed()) {
        worker.send(EVENTS, name, args);
      }
    }
  }

  function tabs() {
    return webContents
      .getAllWebContents()
      .filter(
        (contents) =>
          contents.session === profile && registry.getBrowserIdForWebContents(contents.id) !== null,
      );
  }

  function tab(contents: WebContents) {
    const registration = registry.getRegistrationForWebContents(contents.id);
    if (!registration) {
      throw new Error("This page is not a Paseo browser tab.");
    }
    const owner = webContents.fromId(registration.hostWebContentsId);
    const window = owner ? BrowserWindow.fromWebContents(owner) : null;
    const active = getActivePaseoBrowserWebContentsForHostWindow(registration.hostWebContentsId);
    return {
      id: contents.id,
      windowId: window ? window.id : -1,
      active: active?.id === contents.id,
      highlighted: active?.id === contents.id,
      url: contents.getURL(),
      title: contents.getTitle(),
      incognito: false,
      status: contents.isLoading() ? "loading" : "complete",
      index: tabs().findIndex((item) => item.id === contents.id),
    };
  }

  function ownerWindow(senderId: number | null) {
    if (senderId === null) {
      const focused = BrowserWindow.getFocusedWindow();
      if (!focused) {
        return null;
      }
      const hostId = popupOwners.get(focused.webContents.id);
      const host = hostId === undefined ? null : webContents.fromId(hostId);
      return host ? BrowserWindow.fromWebContents(host) : focused;
    }
    const hostId = popupOwners.get(senderId);
    const contents = webContents.fromId(hostId === undefined ? senderId : hostId);
    return contents ? BrowserWindow.fromWebContents(contents) : null;
  }

  function requestWindow(input: WindowRequest): unknown {
    const { method, args, owner } = input;
    function describe(window: BrowserWindow) {
      const bounds = window.getBounds();
      let state = "normal";
      if (window.isMaximized()) {
        state = "maximized";
      }
      if (window.isMinimized()) {
        state = "minimized";
      }
      return {
        id: window.id,
        focused: window.isFocused(),
        incognito: false,
        type: "normal",
        state,
        ...bounds,
        tabs: tabs()
          .map(tab)
          .filter((item) => item.windowId === window.id),
      };
    }
    if (method === "windows.getAll") {
      return BrowserWindow.getAllWindows()
        .filter((window) => tabs().some((contents) => tab(contents).windowId === window.id))
        .map(describe);
    }
    if (method === "windows.getCurrent") {
      const window = owner;
      if (!window) {
        throw new Error("No browser window is active.");
      }
      return describe(window);
    }
    if (method === "windows.get") {
      const id = z.number().parse(args[0]);
      const window = id === -2 ? owner : BrowserWindow.fromId(id);
      if (!window || !tabs().some((contents) => tab(contents).windowId === window.id)) {
        throw new Error("Unknown browser window.");
      }
      return describe(window);
    }
    throw new Error(`Extension window API ${method} is not supported.`);
  }

  async function request(url: string, senderId: number | null, input: unknown): Promise<unknown> {
    const extension = extensionForUrl(url);
    const manifest = ManifestSchema.parse(extension.manifest);
    const { method, args } = RequestSchema.parse(input);
    if (method === "permissions.contains") {
      const requested = PermissionSchema.parse(args[0]);
      return (
        requested.permissions.every((permission) => manifest.permissions.includes(permission)) &&
        requested.origins.every((origin) =>
          manifest.host_permissions.some((grant) => coversExtensionOrigin(grant, origin)),
        )
      );
    }
    if (method === "permissions.request") {
      // Optional permissions cannot be granted until Paseo owns a consent and persistence flow.
      throw new Error("Optional extension permissions are not supported in Paseo.");
    }
    if (method === "tabs.getCurrent") {
      return undefined;
    }
    if (method === "tabs.query") {
      if (!manifest.permissions.includes("tabs")) {
        throw new Error("The tabs permission is required.");
      }
      const query = QuerySchema.parse(args[0]);
      const owner = ownerWindow(senderId);
      let urls: string[] = [];
      if (typeof query.url === "string") {
        urls = [query.url];
      }
      if (Array.isArray(query.url)) {
        urls = query.url;
      }
      return tabs()
        .map(tab)
        .filter(
          (item) =>
            (query.active === undefined || item.active === query.active) &&
            (!query.currentWindow || item.windowId === owner?.id) &&
            (query.windowId === undefined ||
              item.windowId === (query.windowId === -2 ? owner?.id : query.windowId)) &&
            (urls.length === 0 || urls.some((pattern) => matchesExtensionUrl(pattern, item.url))),
        );
    }
    if (method === "webNavigation.getFrame" || method === "webNavigation.getAllFrames") {
      if (!manifest.permissions.includes("webNavigation")) {
        throw new Error("The webNavigation permission is required.");
      }
      const frameInput = z
        .object({ tabId: z.number(), frameId: z.number().optional() })
        .parse(args[0]);
      const contents = tabs().find((item) => item.id === frameInput.tabId);
      if (!contents) {
        throw new Error("Unknown browser tab.");
      }
      const details = contents.mainFrame.framesInSubtree.map((frame) =>
        describeExtensionFrame(frame, contents.mainFrame),
      );
      if (method === "webNavigation.getAllFrames") {
        return details;
      }
      return details.find((frame) => frame.frameId === frameInput.frameId) ?? null;
    }
    if (method.startsWith("windows.")) {
      if (!manifest.permissions.includes("tabs")) {
        throw new Error("The tabs permission is required.");
      }
      return requestWindow({ method, args, owner: ownerWindow(senderId) });
    }
    if (method.startsWith("notifications.")) {
      if (!manifest.permissions.includes("notifications")) {
        throw new Error("The notifications permission is required.");
      }
      return requestNotification(method, args, extension.id);
    }
    throw new Error(`Extension API ${method} is not supported in Paseo.`);
  }

  ipcMain.handle(CHANNEL, (event, input: unknown) => {
    if (event.sender.session !== profile || !event.senderFrame) {
      throw new Error("Extension APIs belong to the browser profile.");
    }
    return request(event.senderFrame.url, event.sender.id, input);
  });
  profile.serviceWorkers.on("running-status-changed", (details) => {
    if (details.runningStatus === "running") {
      // Chromium reports running after evaluating the background entry script, including listener registration.
      workerReadinessResolvers.get(details.versionId)?.(true);
      workerReadinessResolvers.delete(details.versionId);
      return;
    }
    if (details.runningStatus === "stopped" || details.runningStatus === "stopping") {
      workerReadinessResolvers.get(details.versionId)?.(false);
      workerReadinessResolvers.delete(details.versionId);
      readyWorkers.delete(details.versionId);
      trackedWorkers.delete(details.versionId);
      return;
    }
    const worker = profile.serviceWorkers.getWorkerFromVersionID(details.versionId);
    if (!worker || !worker.scope.startsWith("chrome-extension://")) {
      return;
    }
    trackedWorkers.set(details.versionId, worker);
    workerReadinessResolvers.get(details.versionId)?.(false);
    const ready = new Promise<boolean>((resolve) =>
      workerReadinessResolvers.set(details.versionId, resolve),
    );
    readyWorkers.set(details.versionId, ready);
    worker.ipc.removeHandler(CHANNEL);
    worker.ipc.handle(CHANNEL, (_event, input: unknown) => request(worker.scriptURL, null, input));
  });

  registerExtensionNavigation(profile, emit, async (versionId) => {
    const ready = readyWorkers.get(versionId);
    if (!ready) {
      throw new Error("Extension worker has not started.");
    }
    return ready;
  });

  const preload = path.join(__dirname, "compatibility-preload.js");
  profile.registerPreloadScript({ type: "frame", filePath: preload });
  profile.registerPreloadScript({ type: "service-worker", filePath: preload });
  return {
    /** Associate popup API calls with the app window that owns the selected browser guest. */
    registerPopup(popup: WebContents, guest: WebContents): void {
      const registration = registry.getRegistrationForWebContents(guest.id);
      if (!registration) {
        throw new Error("Extension popup requires a registered browser tab.");
      }
      popupOwners.set(popup.id, registration.hostWebContentsId);
      popup.once("destroyed", () => popupOwners.delete(popup.id));
    },
  };
}
