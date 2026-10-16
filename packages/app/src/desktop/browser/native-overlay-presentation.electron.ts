import { isWeb } from "@/constants/platform";
import type {
  DesktopNativeBrowserBridge,
  DesktopNativeBrowserOverlayFrame,
  DesktopNativeBrowserOverlayTarget,
} from "@/desktop/host";
import type { WebOverlayPresentation } from "@/lib/overlay-presentation";
import { WEB_SURFACE_PLANE } from "@/lib/overlay-root";

interface Placeholder {
  readonly identity: DesktopNativeBrowserOverlayTarget;
  readonly element: HTMLImageElement;
  decoded: boolean;
}
interface Registration {
  readonly token: string;
  prepared: boolean;
  released: boolean;
  ended: boolean;
}
interface Overlap {
  readonly token: string;
  readonly registrations: Set<Registration>;
  readonly invalidated: Set<string>;
  readonly placeholders: Set<Placeholder>;
  references: number;
  live: boolean;
  acceptingFrames: boolean;
  prepared: boolean;
  released: boolean;
  ready: Promise<boolean>;
}

/** One host overlap owns the still through nested scopes, including outer-first dismissal. */
export function createNativeOverlayPresentation(views: DesktopNativeBrowserBridge) {
  let current: Overlap | undefined;

  function endNative(overlap: Overlap): void {
    if (!overlap.prepared || overlap.released) return;
    overlap.released = true;
    // End is idempotent and never focuses or replaces a page.
    void views.endOverlay(overlap.token).catch(() => {});
    for (const registration of overlap.registrations) endRegistration(registration);
  }

  function endRegistration(registration: Registration): void {
    if (!registration.prepared || registration.ended) return;
    registration.ended = true;
    void views.endOverlay(registration.token).catch(() => {});
  }

  function retire(overlap: Overlap): void {
    overlap.live = false;
    overlap.acceptingFrames = false;
    removeFrames(overlap);
    if (current === overlap) current = undefined;
    endNative(overlap);
  }

  async function prepare(overlap: Overlap): Promise<void> {
    const targets = await views.prepareOverlay(overlap.token);
    overlap.prepared = true;
    if (!overlap.live) {
      endNative(overlap);
      return;
    }
    await Promise.all(targets.map((target) => prepareFrame(views, overlap, target)));
  }

  async function admit(overlap: Overlap): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        prepare(overlap),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 250);
        }),
      ]);
      overlap.acceptingFrames = false;
      // Failure to prepare an owned lease is infrastructure failure, not frame failure.
      if (!overlap.live || !overlap.prepared) return false;
      for (const placeholder of overlap.placeholders) {
        if (placeholder.decoded) continue;
        placeholder.element.remove();
        overlap.placeholders.delete(placeholder);
      }
      const frames = [...overlap.placeholders].map((placeholder) => placeholder.identity);
      const committed = await commit(views, overlap, frames);
      if (!overlap.live) return false;
      if (committed) return true;
      // Main refused stale staged identities without hiding. Remove them first,
      // then explicitly commit blank. No recapture, identity substitution or retry.
      removeFrames(overlap);
      return await commit(views, overlap, []);
    } catch {
      // Unknown hide outcome cannot expose an interactive menu.
      return false;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /** Each canonical registration owns a token. Retain the first token and still
   * through the final overlap, so outer-first dismissal cannot reveal a native
   * page while a nested scope waits for its own hide acknowledgement.
   */
  async function admitNested(overlap: Overlap, registration: Registration): Promise<boolean> {
    if (!(await overlap.ready) || registration.released || !overlap.live) return false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        views.prepareOverlay(registration.token).then(() => {
          registration.prepared = true;
          if (!overlap.live || registration.released) endRegistration(registration);
          return undefined;
        }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("Native overlay preparation timed out")), 250);
        }),
      ]);
      if (registration.released || !overlap.live) return false;
      const committed = await commitToken(views, registration.token, []);
      return committed && overlap.live && !registration.released;
    } catch {
      return false;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  function acquire(): WebOverlayPresentation {
    if (!isWeb) throw new Error("Native overlay presentation requires a web renderer");
    const nested = current !== undefined;
    let overlap = current;
    if (!overlap) {
      overlap = {
        token: crypto.randomUUID(),
        registrations: new Set(),
        invalidated: new Set(),
        placeholders: new Set(),
        references: 0,
        live: true,
        acceptingFrames: true,
        prepared: false,
        released: false,
        ready: Promise.resolve(false),
      };
      current = overlap;
      const owned = overlap;
      overlap.ready = admit(owned).then((ready) => {
        if (!ready || !owned.live) {
          retire(owned);
          return false;
        }
        return true;
      });
    }
    overlap.references++;
    const owned = overlap;
    const registration: Registration = {
      token: nested ? crypto.randomUUID() : owned.token,
      prepared: false,
      released: false,
      ended: false,
    };
    if (nested) owned.registrations.add(registration);
    return {
      ready: nested ? admitNested(owned, registration) : owned.ready,
      release() {
        if (registration.released) return;
        registration.released = true;
        if (nested) {
          endRegistration(registration);
          owned.registrations.delete(registration);
        }
        owned.references--;
        if (owned.references === 0) retire(owned);
      },
    };
  }

  function invalidate(browserId: string): void {
    if (!isWeb || !current) return;
    current.invalidated.add(browserId);
    for (const placeholder of current.placeholders) {
      if (placeholder.identity.browserId !== browserId) continue;
      placeholder.element.remove();
      current.placeholders.delete(placeholder);
    }
  }

  return { acquire, invalidate };
}

/** Hide acknowledgement is separately bounded; rejection never means blank admission. */
async function commit(
  views: DesktopNativeBrowserBridge,
  overlap: Overlap,
  frames: DesktopNativeBrowserOverlayTarget[],
): Promise<boolean> {
  if (!overlap.live) return false;
  return await commitToken(views, overlap.token, frames);
}

async function commitToken(
  views: DesktopNativeBrowserBridge,
  token: string,
  frames: DesktopNativeBrowserOverlayTarget[],
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      views.commitOverlay({ token, frames }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Native overlay hide acknowledgement timed out")),
          250,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** A capture/decode error is the approved blank fallback, never a cached image. */
async function prepareFrame(
  views: DesktopNativeBrowserBridge,
  overlap: Overlap,
  target: DesktopNativeBrowserOverlayTarget,
): Promise<void> {
  let placeholder: Placeholder | undefined;
  try {
    const frame = await views.captureOverlay({ token: overlap.token, ...target });
    if (
      !frame ||
      !overlap.live ||
      !overlap.acceptingFrames ||
      overlap.invalidated.has(target.browserId) ||
      frame.browserId !== target.browserId ||
      frame.webContentsId !== target.webContentsId ||
      frame.revision !== target.revision
    )
      return;
    placeholder = stageFrame(frame);
    overlap.placeholders.add(placeholder);
    await placeholder.element.decode();
    if (!overlap.live || !overlap.acceptingFrames || overlap.invalidated.has(target.browserId)) {
      placeholder.element.remove();
      overlap.placeholders.delete(placeholder);
      return;
    }
    placeholder.decoded = true;
  } catch {
    if (!placeholder) return;
    placeholder.element.remove();
    overlap.placeholders.delete(placeholder);
  }
}

function removeFrames(overlap: Overlap): void {
  if (!isWeb) return;
  for (const placeholder of overlap.placeholders) placeholder.element.remove();
  overlap.placeholders.clear();
}

/** Stage below the still-live native surface; decoding precedes native suppression. */
function stageFrame(frame: DesktopNativeBrowserOverlayFrame): Placeholder {
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
  return {
    identity: {
      browserId: frame.browserId,
      webContentsId: frame.webContentsId,
      revision: frame.revision,
    },
    element,
    decoded: false,
  };
}
