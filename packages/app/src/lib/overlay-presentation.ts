import { isWeb } from "@/constants/platform";

export interface WebOverlayPresentation {
  /** True only after native hiding and the bounded still-frame attempt settle. */
  ready: Promise<boolean>;
  release(): void;
}
type PresentationGuard = (scope?: HTMLElement) => WebOverlayPresentation;
let presentationGuard: PresentationGuard | undefined;
const guardListeners = new Set<() => void>();
let guardVersion = 0;

export function getWebOverlayPresentationVersion(): number {
  return guardVersion;
}

/** The same lease can precede a framework modal/portal mounting its DOM. */
export function requestWebOverlayPresentation(scope?: HTMLElement): WebOverlayPresentation | null {
  if (!isWeb || !presentationGuard) return null;
  return presentationGuard(scope);
}

export function hasWebOverlayPresentationGuard(): boolean {
  return presentationGuard !== undefined;
}

/** A menu may predate the first native page, so late installation also admits it. */
export function subscribeWebOverlayPresentationGuard(listener: () => void): () => void {
  guardListeners.add(listener);
  return () => {
    guardListeners.delete(listener);
  };
}

/** Electron installs the native-presentation seam; plain web/native keep their path. */
export function installWebOverlayPresentationGuard(guard: PresentationGuard): () => void {
  if (presentationGuard && presentationGuard !== guard) {
    throw new Error("A web overlay presentation guard is already installed");
  }
  presentationGuard = guard;
  try {
    notifyGuardListeners();
  } catch (error) {
    // Some already-open scopes may have admitted this guard before a later scope
    // failed. Clear it, then notify every scope so those partial leases retire.
    presentationGuard = undefined;
    try {
      notifyGuardListeners();
    } catch (cleanupError) {
      const rollbackError = new AggregateError(
        [error, cleanupError],
        "Web overlay guard setup and rollback failed",
        { cause: cleanupError },
      );
      throw rollbackError;
    }
    throw error;
  }
  return () => {
    if (presentationGuard !== guard) return;
    presentationGuard = undefined;
    notifyGuardListeners();
  };
}

/** Notify all scopes even when one fails, so rollback does not strand later scopes. */
function notifyGuardListeners(): void {
  guardVersion++;
  const errors: unknown[] = [];
  for (const listener of guardListeners) {
    try {
      listener();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) throw new AggregateError(errors, "Web overlay guard notification failed");
}

/** Gate paint and interaction at the canonical registration, before child effects.
 * Visibility preserves layout measurements. Inert prevents autofocus or a backdrop
 * click from reaching an overlay while its native surface still paints above it.
 */
export function prepareWebOverlayPresentation(scope: HTMLElement): WebOverlayPresentation | null {
  if (!isWeb || !presentationGuard) return null;
  const visibility = scope.style.visibility;
  const inert = scope.inert;
  scope.style.visibility = "hidden";
  scope.inert = true;
  let live = true;
  let guard: WebOverlayPresentation;
  try {
    guard = presentationGuard(scope);
  } catch {
    // No hide acknowledgement means admission failed, not a blank-frame fallback.
    guard = { ready: Promise.resolve(false), release() {} };
  }
  const restore = () => {
    scope.style.visibility = visibility;
    scope.inert = inert;
  };
  return {
    ready: guard.ready
      .then((admitted) => {
        if (!live || !admitted) return false;
        restore();
        return true;
      })
      .catch(() => false),
    release() {
      if (!live) return;
      live = false;
      guard.release();
      restore();
    },
  };
}
