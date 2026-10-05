import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, session } from "electron";
import log from "electron-log";
import { installChromeWebStore, uninstallExtension } from "electron-chrome-web-store";
import { z } from "zod";
import { PASEO_BROWSER_PROFILE_PARTITION } from "../browser-profile.js";
import { registerBrowserWebviewNavigationGuards } from "../browser-webviews/index.js";
import { BrowserExtensionCatalog } from "./catalog.js";
import { registerBrowserExtensionActions } from "./actions.js";
import { registerBrowserExtensionCompatibility } from "./compatibility.js";

const ExtensionIdSchema = z.string().regex(/^[a-p]{32}$/);
const EnableInputSchema = z.object({ id: ExtensionIdSchema, enabled: z.boolean() });
const STORE_URL = "https://chromewebstore.google.com/";

/** Install the Store only in the browser session, before any browser guest can navigate. */
export async function registerBrowserExtensions(): Promise<void> {
  const profile = session.fromPartition(PASEO_BROWSER_PROFILE_PARTITION);
  // Workers can start during restore, before the first browser pane or popup exists.
  const compatibility = registerBrowserExtensionCompatibility(profile);
  const extensionsPath = path.join(app.getPath("userData"), "browser-extensions");
  const managedLoads = new Set<string>();
  let storeWindow: BrowserWindow | null = null;

  const catalog = new BrowserExtensionCatalog(
    path.join(app.getPath("userData"), "browser-extensions.json"),
    extensionsPath,
    {
      isLoaded: (id) => Boolean(profile.extensions.getExtension(id)),
      async load(extensionPath) {
        managedLoads.add(extensionPath);
        try {
          return await profile.extensions.loadExtension(extensionPath);
        } finally {
          managedLoads.delete(extensionPath);
        }
      },
      unload: (id) => profile.extensions.removeExtension(id),
      uninstall: (id) => uninstallExtension(id, { session: profile, extensionsPath }),
    },
  );
  let startupError: unknown;
  try {
    await catalog.restore();
  } catch (error) {
    // Do not overwrite an unreadable catalog or prevent the rest of Paseo from starting.
    startupError = error;
    log.error("[browser-extensions] could not restore catalog", error);
  }

  profile.extensions.on("extension-loaded", (_event, extension) => {
    if (managedLoads.has(extension.path)) {
      return;
    }
    void catalog.remember(extension).catch((error) => {
      profile.extensions.removeExtension(extension.id);
      log.error("[browser-extensions] could not save installed extension", error);
      dialog.showErrorBox("Extension could not be saved", String(error));
    });
  });

  await installChromeWebStore({
    session: profile,
    extensionsPath,
    // The catalog owns restore and disabled choices. Store updates would bypass those choices.
    loadExtensions: false,
    autoUpdate: false,
    async beforeInstall(details) {
      if (startupError) {
        return { action: "deny" };
      }
      if (new URL(details.frame.url).origin !== new URL(STORE_URL).origin) {
        return { action: "deny" };
      }
      const installed = (await catalog.list()).find((entry) => entry.id === details.id);
      if (installed) {
        dialog.showErrorBox(
          "Extension already installed",
          "Enable or remove this extension in Settings > Browser.",
        );
        return { action: "deny" };
      }
      const permissions = [
        ...(details.manifest.permissions ?? []),
        ...(details.manifest.host_permissions ?? []),
      ];
      const options: Electron.MessageBoxOptions = {
        type: "question",
        title: "Add extension",
        message: `Add ${details.localizedName}?`,
        detail: `Requested permissions:\n${permissions.join("\n") || "None"}\n\nSome Chrome extension features are unsupported in Paseo. Installation does not guarantee compatibility.`,
        buttons: ["Cancel", "Add extension"],
        defaultId: 0,
        cancelId: 0,
      };
      const result = details.browserWindow
        ? await dialog.showMessageBox(details.browserWindow, options)
        : await dialog.showMessageBox(options);
      return { action: result.response === 1 ? "allow" : "deny" };
    },
  });

  /** Settings APIs belong to app windows, never to remote pages or installed extensions. */
  function assertAppSender(event: Electron.IpcMainInvokeEvent): BrowserWindow {
    const owner = BrowserWindow.fromWebContents(event.sender);
    if (
      !owner ||
      event.sender.session !== session.defaultSession ||
      event.senderFrame !== event.sender.mainFrame
    ) {
      throw new Error("Extension settings are only available to Paseo app windows.");
    }
    if (startupError) {
      throw new Error(`Could not restore browser extensions: ${String(startupError)}`);
    }
    return owner;
  }

  registerBrowserExtensionActions({
    profile,
    assertAppSender,
    onPopupCreated: (guest, popup) => compatibility.registerPopup(popup, guest),
  });

  ipcMain.handle("paseo:browser:extensions:list", (event) => {
    assertAppSender(event);
    return catalog.list();
  });
  ipcMain.handle("paseo:browser:extensions:set-enabled", (event, input: unknown) => {
    assertAppSender(event);
    const { id, enabled } = EnableInputSchema.parse(input);
    return catalog.setEnabled(id, enabled);
  });
  ipcMain.handle("paseo:browser:extensions:remove", async (event, input: unknown) => {
    assertAppSender(event);
    const id = ExtensionIdSchema.parse(input);
    await catalog.remove(id);
    await compatibility.forgetExtensionContextMenus(id);
  });
  ipcMain.handle("paseo:browser:extensions:load-unpacked", async (event) => {
    const owner = assertAppSender(event);
    const result = await dialog.showOpenDialog(owner, {
      title: "Select extension folder",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) {
      return;
    }
    const extensionPath = result.filePaths[0];
    managedLoads.add(extensionPath);
    try {
      const extension = await profile.extensions.loadExtension(extensionPath);
      try {
        await catalog.remember(extension);
      } catch (error) {
        profile.extensions.removeExtension(extension.id);
        throw error;
      }
    } finally {
      managedLoads.delete(extensionPath);
    }
  });
  ipcMain.handle("paseo:browser:extensions:open-store", async (event) => {
    assertAppSender(event);
    if (storeWindow && !storeWindow.isDestroyed()) {
      storeWindow.show();
      storeWindow.focus();
      return;
    }
    const window = new BrowserWindow({
      title: "Chrome Web Store",
      width: 1100,
      height: 800,
      webPreferences: {
        session: profile,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    storeWindow = window;
    registerBrowserWebviewNavigationGuards(window.webContents);
    window.on("closed", () => {
      storeWindow = null;
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    try {
      await window.loadURL(STORE_URL);
    } catch (error) {
      window.close();
      throw error;
    }
  });
}
