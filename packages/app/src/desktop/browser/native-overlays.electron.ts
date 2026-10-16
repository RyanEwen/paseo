import { isWeb } from "@/constants/platform";
import { getDesktopHost, type DesktopNativeBrowserOverlayTarget } from "@/desktop/host";
import { installWebOverlayPresentationGuard } from "@/lib/overlay-presentation";
import { createNativeOverlayPresentation } from "./native-overlay-presentation.electron";

let presentation: ReturnType<typeof createNativeOverlayPresentation> | undefined;
let installed = false;
let listenerCleanupPending = false;
let listenerCleanupError: Error | null = null;

/** Invalidate active lifetimes before local hide/close/layout IPC can settle. */
export function clearNativeBrowserOverlayFrames(browserId: string): void {
  presentation?.invalidate(browserId);
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
    const next = createNativeOverlayPresentation(views);
    // Setup can synchronously admit an already mounted overlay. Rollback retires
    // those leases through the canonical guard installer before it throws.
    installWebOverlayPresentationGuard(next.acquire);
    presentation = next;
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
