import { app, type Session, type WebFrameMain } from "electron";
import { describeExtensionFrame } from "./frames.js";
import { z } from "zod";
import { getPaseoBrowserWebviewRegistry } from "../browser-webviews/index.js";

const NavigationManifestSchema = z.object({ permissions: z.array(z.string()).default([]) });

/** Bridge committed/completed/failed navigations using Chromium's extension frame IDs and wake idle MV3 workers. */
export function registerExtensionNavigation(
  profile: Session,
  emit: (id: string, name: string, ...args: unknown[]) => void,
): void {
  const registry = getPaseoBrowserWebviewRegistry();
  app.on("web-contents-created", (_createdEvent, contents) => {
    if (contents.session !== profile) {
      return;
    }
    /** Chromium uses frame-tree node IDs for child extension frames and zero for the main frame. */
    function navigation(name: string, url: string, frame: WebFrameMain, error?: string) {
      if (registry.getBrowserIdForWebContents(contents.id) === null) {
        return;
      }
      const detail = {
        ...describeExtensionFrame(frame, contents.mainFrame),
        tabId: contents.id,
        url,
        timeStamp: Date.now(),
        error,
      };
      for (const extension of profile.extensions.getAllExtensions()) {
        const manifest = NavigationManifestSchema.parse(extension.manifest);
        if (!manifest.permissions.includes("webNavigation")) {
          continue;
        }
        emit(extension.id, name, detail);
      }
    }
    function findFrame(process: number, routing: number) {
      return contents.mainFrame.framesInSubtree.find(
        (item) => item.processId === process && item.routingId === routing,
      );
    }
    function notify(
      name: string,
      url: string,
      process: number,
      routing: number,
      error?: string,
    ): void {
      const frame = findFrame(process, routing);
      if (frame) {
        navigation(name, url, frame, error);
      }
    }
    contents.on("did-frame-navigate", (_event, url, _code, _text, _main, process, routing) =>
      notify("webNavigation.onCommitted", url, process, routing),
    );
    contents.on("did-frame-finish-load", (_event, _main, process, routing) => {
      const frame = findFrame(process, routing);
      if (frame) {
        notify("webNavigation.onCompleted", frame.url, process, routing);
      }
    });
    contents.on("did-fail-load", (_event, _code, description, url, _main, process, routing) =>
      notify("webNavigation.onErrorOccurred", url, process, routing, description),
    );
  });
}
