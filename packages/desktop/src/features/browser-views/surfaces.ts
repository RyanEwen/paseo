import type { TabImage } from "../browser-automation/service.js";

export interface NativeBrowserSurface {
  capture(signal: AbortSignal, rect?: Electron.Rectangle): Promise<TabImage>;
}
const surfaces = new Map<number, NativeBrowserSurface>();
/** Publish only a main-owned native capture surface; cleanup is identity-fenced. */
export function registerNativeBrowserSurface(
  id: number,
  surface: NativeBrowserSurface,
): () => void {
  surfaces.set(id, surface);
  return () => {
    if (surfaces.get(id) === surface) surfaces.delete(id);
  };
}
/** Native targets use their own surface lifecycle instead of webview frame leases. */
export function getNativeBrowserSurface(id: number): NativeBrowserSurface | undefined {
  return surfaces.get(id);
}
