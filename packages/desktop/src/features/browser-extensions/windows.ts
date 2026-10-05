import { app, BrowserWindow, session, type Session } from "electron";
import { z } from "zod";

const ManifestSchema = z.object({ permissions: z.array(z.string()).default([]) });

interface ExtensionWindowRequest {
  method: string;
  args: unknown[];
  owner: BrowserWindow | null;
}

interface ExtensionWindowsOptions {
  profile: Session;
  getTabs(windowId: number): unknown[];
  resolveOwner(window: BrowserWindow): BrowserWindow | null;
  emit(id: string, name: string, ...args: unknown[]): void;
}

/** Describe app-owned browser windows and expose their actual creation, focus and close events. */
export function createExtensionWindows(options: ExtensionWindowsOptions) {
  function isBrowserWindow(window: BrowserWindow): boolean {
    return window.webContents.session === session.defaultSession;
  }

  function describe(window: BrowserWindow) {
    let state = "normal";
    if (window.isMaximized()) {
      state = "maximized";
    }
    if (window.isMinimized()) {
      state = "minimized";
    }
    const focused = BrowserWindow.getFocusedWindow();
    const focusedOwner = focused ? options.resolveOwner(focused) : null;
    return {
      id: window.id,
      focused: focusedOwner?.id === window.id,
      incognito: false,
      type: "normal",
      state,
      ...window.getBounds(),
      tabs: options.getTabs(window.id),
    };
  }

  function emit(name: string, detail: unknown): void {
    for (const extension of options.profile.extensions.getAllExtensions()) {
      const manifest = ManifestSchema.parse(extension.manifest);
      if (manifest.permissions.includes("tabs")) {
        options.emit(extension.id, name, detail);
      }
    }
  }

  let focusedId = -1;
  /** Popup focus belongs to its owning browser window, while focus outside Paseo reports WINDOW_ID_NONE. */
  function updateFocus(): void {
    const focused = BrowserWindow.getFocusedWindow();
    const owner = focused ? options.resolveOwner(focused) : null;
    const id = owner && isBrowserWindow(owner) ? owner.id : -1;
    if (id !== focusedId) {
      focusedId = id;
      emit("windows.onFocusChanged", id);
    }
  }

  function observe(window: BrowserWindow): void {
    window.on("focus", updateFocus);
    window.on("blur", updateFocus);
    if (isBrowserWindow(window)) {
      const id = window.id;
      window.once("closed", () => emit("windows.onRemoved", id));
    }
  }

  BrowserWindow.getAllWindows().forEach(observe);
  app.on("browser-window-created", (_event, window) => {
    observe(window);
    if (isBrowserWindow(window)) {
      emit("windows.onCreated", describe(window));
    }
  });

  return {
    /** Resolve Chrome's current-window sentinel against the caller's owning desktop window. */
    request({ method, args, owner }: ExtensionWindowRequest): unknown {
      if (method === "windows.getAll") {
        return BrowserWindow.getAllWindows().filter(isBrowserWindow).map(describe);
      }
      let window = owner;
      if (method === "windows.get") {
        const id = z.number().parse(args[0]);
        window = id === -2 ? owner : BrowserWindow.fromId(id);
      } else if (method !== "windows.getCurrent") {
        throw new Error(`Extension window API ${method} is not supported.`);
      }
      if (!window || !isBrowserWindow(window)) {
        throw new Error("Unknown browser window.");
      }
      return describe(window);
    },
  };
}
