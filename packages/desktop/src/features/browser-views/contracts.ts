import { z } from "zod";

const ContentsId = z.number().int().positive();
const BrowserId = z.string().trim().min(1).max(256);
const BoundsSchema = z.strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive().max(16384),
  height: z.number().finite().positive().max(16384),
});
/** Renderer commands carry browser identity, never arbitrary webContents identifiers. */
export const CreateBrowserViewSchema = z.strictObject({
  browserId: BrowserId,
  workspaceId: BrowserId,
  url: z.string().max(8192),
});
export const BrowserViewIdentitySchema = z.strictObject({
  browserId: BrowserId,
  webContentsId: ContentsId,
});
/** Origin/clip are host CSS. Fixed extents are page CSS; responsive extents are host CSS. */
export const BrowserViewPresentationSchema = z.strictObject({
  browserId: BrowserId,
  webContentsId: ContentsId,
  visible: z.boolean(),
  viewportMode: z.enum(["fixed", "responsive"]),
  bounds: BoundsSchema,
  clip: BoundsSchema.optional(),
});
/** Trusted renderer scripts preserve selectors/annotations on the addressed native page. */
export const BrowserViewScriptSchema = BrowserViewIdentitySchema.extend({
  code: z.string().max(1048576),
});
export const BrowserViewControlSchema = z.strictObject({
  browserId: BrowserId,
  webContentsId: ContentsId,
  command: z.enum(["back", "forward", "reload", "stop"]),
});
export const BrowserViewNavigationSchema = z.strictObject({
  browserId: BrowserId,
  webContentsId: ContentsId,
  url: z.string().max(8192),
});

export interface NativeBrowserViewState {
  browserId: string;
  workspaceId: string;
  webContentsId: number;
  url: string;
  title: string;
  faviconUrl: string | null;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  visible: boolean;
  /** Page zoom / host UI zoom, for the DOM frame footprint in host CSS. */
  presentationScale: number;
  focused: boolean;
  lastError: string | null;
}
export const BROWSER_VIEW_STATE_EVENT = "paseo:event:browser-view-state";

/** Overlay tokens belong to the trusted host, never a page-provided identifier. */
export const BrowserViewOverlaySchema = z.strictObject({ token: z.uuid() });
export const BrowserViewOverlayCaptureSchema = BrowserViewOverlaySchema.extend({
  browserId: BrowserId,
  webContentsId: ContentsId,
  revision: z.number().int().nonnegative(),
});
export const BrowserViewOverlayCommitSchema = BrowserViewOverlaySchema.extend({
  frames: z.array(BrowserViewOverlayCaptureSchema.omit({ token: true })).max(256),
});
export interface NativeBrowserOverlayTarget {
  browserId: string;
  webContentsId: number;
  revision: number;
}
export interface NativeBrowserOverlayFrame extends NativeBrowserOverlayTarget {
  /** Visible native crop expressed in host CSS, without page viewport changes. */
  bounds: { x: number; y: number; width: number; height: number };
  dataUrl: string;
}
export const BROWSER_VIEW_OVERLAY_INVALIDATED_EVENT =
  "paseo:event:browser-view-overlay-invalidated";
