import {
  ensureNativeBrowserOverlayProtection,
  clearNativeBrowserOverlayFrames,
} from "./native-overlays.electron";
import type { BrowserViewport } from "./store";
import {
  createNativeBrowserPage,
  type NativeBrowserPage,
  type BrowserBounds,
} from "./native-page.electron";

interface ResidentPage {
  page: NativeBrowserPage;
  workspaceId: string;
  bounds: BrowserBounds;
  clip?: BrowserBounds;
  visible: boolean;
  viewportMode: BrowserViewport["mode"];
}
const pages = new Map<string, ResidentPage>();

/** Retain main-owned documents across pane unmounts and inactive workspaces. */
export function ensureResidentNativeBrowser(input: {
  browserId: string;
  workspaceId: string;
  url: string;
}): NativeBrowserPage {
  ensureNativeBrowserOverlayProtection();
  const existing = pages.get(input.browserId);
  if (existing) {
    if (existing.workspaceId !== input.workspaceId)
      throw new Error("Native browser workspace changed");
    return existing.page;
  }
  const page = createNativeBrowserPage(input);
  pages.set(input.browserId, {
    page,
    workspaceId: input.workspaceId,
    bounds: { x: 0, y: 0, width: 1280, height: 800 },
    visible: false,
    viewportMode: "fixed",
  });
  return page;
}

/** Preserve a full page viewport and separately intersect its native presentation.
 * Origins, anchor and clip use host CSS; fixed extents use page CSS. The DOM
 * frame already includes pageZoom/hostZoom. Keep fractional edges here: main
 * converts to DIP before rounding inward. Never shrink the page to the clip.
 */
export function resolveNativeBrowserGeometry(
  anchor: BrowserBounds,
  clip: BrowserBounds,
  viewport: BrowserViewport,
): { bounds: BrowserBounds; clip: BrowserBounds; visible: boolean } {
  const bounds = {
    ...anchor,
    ...(viewport.mode === "fixed" ? { width: viewport.width, height: viewport.height } : {}),
  };
  const x = Math.max(bounds.x, clip.x);
  const y = Math.max(bounds.y, clip.y);
  const right = Math.min(anchor.x + anchor.width, clip.x + clip.width);
  const bottom = Math.min(anchor.y + anchor.height, clip.y + clip.height);
  return {
    bounds,
    clip: { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) },
    visible: right > x && bottom > y,
  };
}

/** Apply actual pane geometry to the native surface; the DOM anchor contains no browser. */
export function presentResidentNativeBrowser(
  browserId: string,
  anchor: HTMLElement,
  clip: HTMLElement,
  viewport: BrowserViewport,
): Promise<void> {
  const resident = pages.get(browserId);
  if (!resident) return Promise.reject(new Error("Native browser is not registered"));
  const anchorRect = anchor.getBoundingClientRect();
  const clipRect = clip.getBoundingClientRect();
  const geometry = resolveNativeBrowserGeometry(
    { x: anchorRect.left, y: anchorRect.top, width: anchorRect.width, height: anchorRect.height },
    { x: clipRect.left, y: clipRect.top, width: clipRect.width, height: clipRect.height },
    viewport,
  );
  if (
    JSON.stringify([resident.bounds, resident.clip, resident.visible]) !==
    JSON.stringify([geometry.bounds, geometry.clip, geometry.visible])
  ) {
    clearNativeBrowserOverlayFrames(browserId);
  }
  resident.bounds = geometry.bounds;
  resident.clip = geometry.clip;
  resident.visible = geometry.visible;
  resident.viewportMode = viewport.mode;
  return resident.page.present(geometry.bounds, geometry.visible, geometry.clip, viewport.mode);
}

/** Hide presentation while preserving viewport, document drafts and profile ownership. */
export function hideResidentNativeBrowser(
  browserId: string,
  viewport?: BrowserViewport,
): Promise<void> {
  const resident = pages.get(browserId);
  if (!resident) return Promise.resolve();
  clearNativeBrowserOverlayFrames(browserId);
  resident.visible = false;
  if (viewport) resident.viewportMode = viewport.mode;
  if (viewport?.mode === "fixed")
    resident.bounds = { ...resident.bounds, width: viewport.width, height: viewport.height };
  return resident.page.present(resident.bounds, false, resident.clip, resident.viewportMode);
}

/** Resize the actual native page even if no renderer pane is mounted. */
export async function resizeResidentNativeBrowser(input: {
  browserId: string;
  width: number;
  height: number;
}): Promise<{ width: number; height: number } | null> {
  const resident = pages.get(input.browserId);
  if (
    !resident ||
    !Number.isFinite(input.width) ||
    !Number.isFinite(input.height) ||
    input.width <= 0 ||
    input.height <= 0
  )
    return null;
  clearNativeBrowserOverlayFrames(input.browserId);
  const dimensions = { width: Math.round(input.width), height: Math.round(input.height) };
  resident.bounds = { ...resident.bounds, ...dimensions };
  resident.viewportMode = "fixed";
  // Store selection updates the mounted pane; an unmounted target remains hidden.
  await resident.page.present(
    resident.bounds,
    resident.visible,
    resident.clip,
    resident.viewportMode,
  );
  return dimensions;
}

/** Explicit tab closure is the native destruction boundary, including background tabs. */
export async function removeResidentNativeBrowser(browserId: string): Promise<boolean> {
  const resident = pages.get(browserId);
  if (!resident) return false;
  clearNativeBrowserOverlayFrames(browserId);
  pages.delete(browserId);
  await resident.page.close();
  return true;
}
