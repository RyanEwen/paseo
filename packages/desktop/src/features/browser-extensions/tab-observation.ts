import type { WebContents } from "electron";
import type { BrowserExtensionTab } from "./tab-projection.js";

export type BrowserExtensionTabChanges = Partial<
  Pick<BrowserExtensionTab, "url" | "title" | "status">
>;
interface TabObservationOptions {
  contents: WebContents;
  describe(): BrowserExtensionTab | null;
  onUpdated(changes: BrowserExtensionTabChanges, tab: BrowserExtensionTab): void;
}

/** Observe native document/load changes once, retaining the last tab snapshot for removal after destruction. */
export function observeExtensionTab(options: TabObservationOptions) {
  const initial = options.describe();
  if (!initial) {
    throw new Error("A browser tab must be registered before observing it.");
  }
  let currentTab = initial;

  function update(): void {
    if (options.contents.isDestroyed()) {
      return;
    }
    const next = options.describe();
    if (!next) {
      return;
    }
    const changes: BrowserExtensionTabChanges = {};
    if (next.url !== currentTab.url) {
      changes.url = next.url;
    }
    if (next.title !== currentTab.title) {
      changes.title = next.title;
    }
    if (next.status !== currentTab.status) {
      changes.status = next.status;
    }
    currentTab = next;
    if (Object.keys(changes).length > 0) {
      options.onUpdated(changes, next);
    }
  }

  /** Remove every installed listener; safe on either registry removal or native destruction. */
  function detach(): void {
    const contents = options.contents;
    contents.removeListener("did-start-loading", update);
    contents.removeListener("did-stop-loading", update);
    contents.removeListener("did-navigate", update);
    contents.removeListener("did-navigate-in-page", update);
    contents.removeListener("page-title-updated", update);
    contents.removeListener("destroyed", detach);
  }

  const contents = options.contents;
  contents.on("did-start-loading", update);
  contents.on("did-stop-loading", update);
  contents.on("did-navigate", update);
  contents.on("did-navigate-in-page", update);
  contents.on("page-title-updated", update);
  contents.once("destroyed", detach);
  return { getCurrent: () => currentTab, detach };
}
