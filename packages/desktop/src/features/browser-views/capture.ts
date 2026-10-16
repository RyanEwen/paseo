// Native capture priming is adapted from VS Code browserView.ts.
// Copyright (c) 2015 - present Microsoft Corporation. MIT License.
// See MICROSOFT-LICENSE.txt for the retained permission notice.
import type { WebContentsView } from "electron";
import { CdpSessionQueue } from "../browser-automation/cdp-session-queue.js";
import type { NativeBrowserSurface } from "./surfaces.js";

/** Capture an owned native viewport without renderer frame callbacks or host focus.
 * Only definitive UnknownVizError replies are retried, following VS Code's
 * bounded capture path. Cancellation never releases an unsettled native operation
 * or replays a capture whose outcome is unknown.
 */
export function createNativeBrowserSurface(
  view: WebContentsView,
  isPresented: () => boolean,
): NativeBrowserSurface {
  const queue = new CdpSessionQueue();
  return {
    capture: (signal, rect) =>
      queue.run(async () => {
        signal.throwIfAborted();
        if (view.webContents.isDestroyed()) throw new Error("Native browser target closed");
        if (!isPresented()) {
          view.setVisible(true);
          view.setVisible(false);
        }
        let lastError: unknown;
        for (let attempt = 0; attempt < 5; attempt++) {
          signal.throwIfAborted();
          if (view.webContents.isDestroyed()) throw new Error("Native browser target closed");
          try {
            return await view.webContents.capturePage(rect, { stayHidden: true });
          } catch (error) {
            if (!(error instanceof Error) || error.message !== "UnknownVizError") throw error;
            lastError = error;
            if (attempt < 4) await new Promise<void>((resolve) => setTimeout(resolve, 16));
          }
        }
        throw lastError;
      }, signal),
  };
}
