import { app, type Session, type WebFrameMain } from "electron";
import log from "electron-log";
import { describeExtensionFrame } from "./frames.js";
import { z } from "zod";
import { getPaseoBrowserWebviewRegistry } from "../browser-webviews/index.js";

const NavigationManifestSchema = z.object({ permissions: z.array(z.string()).default([]) });

/** Bridge committed/completed/failed navigations using Chromium's extension frame IDs and wake idle MV3 workers. */
export function registerExtensionNavigation(
  profile: Session,
  emit: (id: string, name: string, ...args: unknown[]) => void,
  waitForWorkerReady: (versionId: number) => Promise<boolean>,
): void {
  const registry = getPaseoBrowserWebviewRegistry();
  const deliveries = new Map<string, Promise<void>>();
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
        const previous = deliveries.get(extension.id) ?? Promise.resolve();
        async function deliver(): Promise<void> {
          await previous;
          try {
            const background = z
              .object({
                background: z.object({ service_worker: z.string().optional() }).optional(),
              })
              .parse(extension.manifest).background;
            if (!profile.extensions.getExtension(extension.id)) {
              return;
            }
            if (background?.service_worker) {
              const running = Object.entries(profile.serviceWorkers.getAllRunning()).find((entry) =>
                entry[1].scope.startsWith(`chrome-extension://${extension.id}/`),
              );
              let worker = running
                ? profile.serviceWorkers.getWorkerFromVersionID(Number(running[0]))
                : undefined;
              if (!worker) {
                worker = await profile.serviceWorkers.startWorkerForScope(
                  `chrome-extension://${extension.id}/`,
                );
              }
              const listening = await waitForWorkerReady(worker.versionId);
              if (!listening) {
                return;
              }
            }
            if (profile.extensions.getExtension(extension.id)) {
              emit(extension.id, name, detail);
            }
          } catch (failure: unknown) {
            log.error(`Extension navigation delivery failed for ${extension.id}`, failure);
          }
        }
        const delivery = deliver();
        deliveries.set(extension.id, delivery);
        void delivery.finally(() => {
          if (deliveries.get(extension.id) === delivery) {
            deliveries.delete(extension.id);
          }
        });
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
