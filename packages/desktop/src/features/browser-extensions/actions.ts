import { BrowserWindow, ipcMain, type Session, type WebContents } from "electron";
import { z } from "zod";
import { getPaseoBrowserWebContentsForHostWindow } from "../browser-webviews/index.js";
import { getExtensionPopupUrl } from "./manifest.js";

const PopupInputSchema = z.object({
  id: z.string().regex(/^[a-p]{32}$/),
  browserId: z.string().min(1),
});

interface ExtensionActionsOptions {
  profile: Session;
  assertAppSender(event: Electron.IpcMainInvokeEvent): BrowserWindow;
  onPopupCreated?(guest: WebContents, popup: WebContents): void;
}

/** Open real extension documents in the browser profile, isolated from Paseo's preload. */
export function registerBrowserExtensionActions(options: ExtensionActionsOptions): void {
  const { profile, assertAppSender } = options;
  const windows = new Map<string, BrowserWindow>();
  const pending = new Map<string, Promise<BrowserWindow>>();

  profile.extensions.on("extension-unloaded", (_event, extension) => {
    for (const [key, window] of windows) {
      if (key.endsWith(`:${extension.id}`)) {
        window.close();
      }
    }
  });

  ipcMain.handle("paseo:browser:extensions:actions", (event) => {
    assertAppSender(event);
    return profile.extensions.getAllExtensions().map((extension) => ({
      id: extension.id,
      name: extension.name,
      hasPopup: getExtensionPopupUrl(extension.id, extension.manifest) !== null,
    }));
  });

  ipcMain.handle("paseo:browser:extensions:open-popup", async (event, input: unknown) => {
    const owner = assertAppSender(event);
    const { id, browserId } = PopupInputSchema.parse(input);
    const guest = getPaseoBrowserWebContentsForHostWindow(browserId, event.sender.id);
    if (!guest || guest.session !== profile) {
      throw new Error("The browser tab is no longer available.");
    }
    const extension = profile.extensions.getExtension(id);
    if (!extension) {
      throw new Error("This extension is disabled or no longer installed.");
    }
    const key = `${owner.id}:${id}`;
    const opening = pending.get(key);
    if (opening) {
      await opening;
      return;
    }
    const previous = windows.get(key);
    if (previous && !previous.isDestroyed()) {
      previous.show();
      previous.focus();
      return;
    }
    const loading = openBrowserExtensionPopup({
      owner,
      profile,
      extension,
      onCreated: (popup) => {
        windows.set(key, popup);
        popup.on("closed", () => windows.delete(key));
        options.onPopupCreated?.(guest, popup.webContents);
      },
    });
    pending.set(key, loading);
    try {
      await loading;
    } finally {
      pending.delete(key);
    }
  });
}

interface ExtensionPopupOptions {
  owner: BrowserWindow;
  profile: Session;
  extension: Electron.Extension;
  show?: boolean;
  onCreated?(window: BrowserWindow): void;
}

/** Load an installed extension's packaged popup with browser-profile storage and APIs. */
export async function openBrowserExtensionPopup({
  owner,
  profile,
  extension,
  show = true,
  onCreated,
}: ExtensionPopupOptions): Promise<BrowserWindow> {
  const url = getExtensionPopupUrl(extension.id, extension.manifest);
  if (!url) {
    throw new Error("This extension does not provide a toolbar popup.");
  }
  const window = new BrowserWindow({
    parent: owner,
    title: extension.name,
    width: 420,
    height: 640,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      session: profile,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  /** Redirects and direct navigation share the same extension-origin boundary. */
  function guardNavigation(navigation: Electron.Event, targetUrl: string): void {
    const target = new URL(targetUrl);
    if (target.protocol !== "chrome-extension:" || target.hostname !== extension.id) {
      navigation.preventDefault();
    }
  }
  window.webContents.on("will-navigate", (navigation) =>
    guardNavigation(navigation, navigation.url),
  );
  window.webContents.on("will-redirect", (navigation, targetUrl) =>
    guardNavigation(navigation, targetUrl),
  );
  function closeWithOwner(): void {
    if (!window.isDestroyed()) {
      window.close();
    }
  }
  owner.on("closed", closeWithOwner);
  window.on("closed", () => owner.removeListener("closed", closeWithOwner));
  try {
    onCreated?.(window);
    await window.loadURL(url);
    if (show) {
      window.show();
      window.focus();
    }
    return window;
  } catch (error) {
    if (!window.isDestroyed()) {
      window.close();
    }
    throw error;
  }
}
