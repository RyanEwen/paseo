import { BrowserWindow, webContents, type Session, type WebContents } from "electron";
import { z } from "zod";
import { getPaseoBrowserWebviewRegistry } from "../browser-webviews/index.js";
import { createBrowserTabProjection, type BrowserExtensionTab } from "./tab-projection.js";

const ManifestSchema = z.object({ permissions: z.array(z.string()).default([]) });
interface ExtensionTabsOptions {
  profile: Session;
  emit(id: string, name: string, ...args: unknown[]): void;
}
interface TabObservation {
  tab: BrowserExtensionTab;
  detach(): void;
}

/** Publish real identity, selection and guest load changes; retained hidden tabs do not become newly activated. */
export function registerExtensionTabs(options: ExtensionTabsOptions): void {
  const registry = getPaseoBrowserWebviewRegistry();
  const projection = createBrowserTabProjection(options.profile);
  const observed = new Map<number, TabObservation>();
  const watchedOwners = new WeakSet<BrowserWindow>();
  const closingWindowIds = new Set<number>();

  /** Guest destruction precedes owner destruction; retain the real close signal for removal details. */
  function observeOwner(windowId: number): void {
    const owner = BrowserWindow.fromId(windowId);
    if (!owner || watchedOwners.has(owner)) {
      return;
    }
    watchedOwners.add(owner);
    owner.on("close", (event) => {
      closingWindowIds.add(windowId);
      queueMicrotask(() => {
        if (event.defaultPrevented) {
          closingWindowIds.delete(windowId);
        }
      });
    });
    owner.once("closed", () => {
      queueMicrotask(() => closingWindowIds.delete(windowId));
    });
  }

  function emit(name: string, ...args: unknown[]): void {
    for (const extension of options.profile.extensions.getAllExtensions()) {
      if (ManifestSchema.parse(extension.manifest).permissions.includes("tabs")) {
        options.emit(extension.id, name, ...args);
      }
    }
  }

  function observe(contents: WebContents): void {
    const previous = observed.get(contents.id);
    previous?.detach();
    const initial = projection.describe(contents);
    observeOwner(initial.windowId);
    function update(): void {
      const observation = observed.get(contents.id);
      if (!observation || !registry.getRegistrationForWebContents(contents.id)) {
        return;
      }
      const current = projection.describe(contents);
      const changes: Partial<Pick<BrowserExtensionTab, "url" | "title" | "status">> = {};
      if (current.url !== observation.tab.url) {
        changes.url = current.url;
      }
      if (current.title !== observation.tab.title) {
        changes.title = current.title;
      }
      if (current.status !== observation.tab.status) {
        changes.status = current.status;
      }
      observation.tab = current;
      if (Object.keys(changes).length > 0) {
        emit("tabs.onUpdated", contents.id, changes, current);
      }
    }
    function destroyed(): void {
      registry.unregisterWebContents(contents.id);
    }
    contents.on("did-start-loading", update);
    contents.on("did-stop-loading", update);
    contents.on("did-navigate", update);
    contents.on("did-navigate-in-page", update);
    contents.on("page-title-updated", update);
    contents.once("destroyed", destroyed);
    observed.set(contents.id, {
      tab: initial,
      detach() {
        contents.removeListener("did-start-loading", update);
        contents.removeListener("did-stop-loading", update);
        contents.removeListener("did-navigate", update);
        contents.removeListener("did-navigate-in-page", update);
        contents.removeListener("page-title-updated", update);
        contents.removeListener("destroyed", destroyed);
      },
    });
  }

  // Existing guests get observers without inventing creation events at module registration.
  for (const contents of projection.list()) {
    observe(contents);
  }
  registry.subscribe((event) => {
    if (event.type === "unregistered") {
      const observation = observed.get(event.webContentsId);
      if (observation) {
        observed.delete(event.webContentsId);
        observation.detach();
        emit("tabs.onRemoved", event.webContentsId, {
          windowId: observation.tab.windowId,
          isWindowClosing: closingWindowIds.has(observation.tab.windowId),
        });
      }
      return;
    }
    if (event.webContentsId === null) {
      return;
    }
    const contents = webContents.fromId(event.webContentsId);
    if (!contents || contents.session !== options.profile || contents.isDestroyed()) {
      return;
    }
    if (event.type === "registered") {
      observe(contents);
      emit("tabs.onCreated", projection.describe(contents));
      return;
    }
    const tab = projection.describe(contents);
    emit("tabs.onActivated", { tabId: tab.id, windowId: tab.windowId });
  });
}
