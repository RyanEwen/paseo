import { isWeb } from "@/constants/platform";
import {
  getDesktopHost,
  type DesktopNativeBrowserBridge,
  type DesktopNativeBrowserOverlayFrame,
  type DesktopNativeBrowserOverlayTarget,
} from "@/desktop/host";
import { installWebOverlayPresentationGuard } from "@/lib/overlay-presentation";
import { WEB_SURFACE_PLANE } from "@/lib/overlay-root";

interface Placeholder {
  readonly identity: DesktopNativeBrowserOverlayTarget;
  readonly element: HTMLImageElement;
}
interface OverlayFrames {
  readonly invalidated: Set<string>;
  readonly placeholders: Set<Placeholder>;
}
const overlays = new Set<OverlayFrames>();
let installed = false;
let listenerCleanupPending = false;
let listenerCleanupError: Error | null = null;

/** Invalidate active lifetimes before local hide/close/layout IPC can settle. */
export function clearNativeBrowserOverlayFrames(browserId: string): void {
  for (const overlay of overlays) {
    overlay.invalidated.add(browserId);
    for (const placeholder of overlay.placeholders) {
      if (placeholder.identity.browserId !== browserId) continue;
      placeholder.element.remove();
      overlay.placeholders.delete(placeholder);
    }
  }
}

/** Install once before the first native page is created. No browser/native fallback imports it. */
export function ensureNativeBrowserOverlayProtection(): void {
  if (installed || !isWeb) return;
  if (listenerCleanupPending) throw new Error("Native browser overlay listener cleanup is pending");
  if (listenerCleanupError) throw listenerCleanupError;
  const host = getDesktopHost();
  const views = host?.browser?.views;
  const subscribe = host?.events?.on;
  if (!views || !subscribe) throw new Error("The native browser overlay bridge is unavailable");
  let subscription: Promise<() => void> | undefined;
  let listening = false;
  try {
    // The preload attaches synchronously. Commit only after both listener and
    // guard setup succeed; a failed attempt cannot claim the next retry.
    subscription = Promise.resolve(
      subscribe("browser-view-overlay-invalidated", (payload: unknown) => {
        if (!listening || !payload || typeof payload !== "object") return;
        const target = payload as DesktopNativeBrowserOverlayTarget;
        if (
          typeof target.browserId !== "string" ||
          !Number.isInteger(target.webContentsId) ||
          !Number.isInteger(target.revision)
        )
          return;
        clearNativeBrowserOverlayFrames(target.browserId);
      }),
    );
    installWebOverlayPresentationGuard(() => {
      const token = crypto.randomUUID();
      const lifetime: OverlayFrames = { invalidated: new Set(), placeholders: new Set() };
      overlays.add(lifetime);
      let live = true;
      let admitted = false;
      const releaseNative = () => {
        // Closing a menu never invokes native/OS focus or creates a replacement tab.
        void views.endOverlay(token).catch(() => {});
      };
      const ready = (async () => {
        const targets = await views.beginOverlay(token);
        admitted = true;
        if (!live) {
          releaseNative();
          return false;
        }
        // Main has hidden the live surface. A failed/timed-out frame leaves the
        // existing browser area blank and still allows the menu to open.
        await Promise.all(
          targets.map(async (target) => {
            const frame = await captureFrame(views, token, target);
            if (
              !live ||
              !frame ||
              frame.browserId !== target.browserId ||
              frame.webContentsId !== target.webContentsId ||
              frame.revision !== target.revision ||
              lifetime.invalidated.has(frame.browserId)
            )
              return;
            const placeholder = paintFrame(frame);
            lifetime.placeholders.add(placeholder);
          }),
        );
        return live;
      })().catch(() => {
        // A failed hide acknowledgement is not a capture failure. Do not expose
        // interactive DOM over a possibly still-interactive native page.
        return admitted && live;
      });
      return {
        ready,
        release() {
          if (!live) return;
          live = false;
          overlays.delete(lifetime);
          for (const placeholder of lifetime.placeholders) placeholder.element.remove();
          lifetime.placeholders.clear();
          lifetime.invalidated.clear();
          // If begin is pending its completion performs the release instead.
          if (admitted) releaseNative();
        },
      };
    });
    listening = true;
    installed = true;
  } catch (error) {
    // An installer failure rolls back its guard. Fence the listener immediately,
    // then await the bridge's unsubscribe handle before permitting another setup.
    listening = false;
    if (subscription) {
      listenerCleanupPending = true;
      void retireFailedSubscription(subscription);
    }
    throw error;
  }
}

/** Retire a failed setup without an unhandled rejection or overlapping retry. */
async function retireFailedSubscription(subscription: Promise<() => void>): Promise<void> {
  try {
    const unsubscribe = await subscription;
    unsubscribe();
  } catch (error) {
    listenerCleanupError = new Error("Native browser overlay listener cleanup failed", {
      cause: error,
    });
  } finally {
    listenerCleanupPending = false;
  }
}

/** A failed frame request admits blank after native hiding was acknowledged. */
async function captureFrame(
  views: DesktopNativeBrowserBridge,
  token: string,
  target: DesktopNativeBrowserOverlayTarget,
): Promise<DesktopNativeBrowserOverlayFrame | null> {
  try {
    return await views.captureOverlay({ token, ...target });
  } catch {
    return null;
  }
}

/** Present a single visible crop below the overlay plane, never a continuous stream. */
function paintFrame(frame: DesktopNativeBrowserOverlayFrame): Placeholder {
  if (!isWeb) throw new Error("Native browser still frames require a web renderer");
  const element = document.createElement("img");
  element.alt = "";
  element.setAttribute("aria-hidden", "true");
  element.draggable = false;
  const { x, y, width, height } = frame.bounds;
  Object.assign(element.style, {
    position: "fixed",
    left: `${x}px`,
    top: `${y}px`,
    width: `${width}px`,
    height: `${height}px`,
    pointerEvents: "none",
    zIndex: String(WEB_SURFACE_PLANE.browser),
  });
  element.src = frame.dataUrl;
  document.body.append(element);
  return { identity: frame, element };
}
