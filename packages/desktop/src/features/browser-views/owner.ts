import {
  View,
  WebContentsView,
  type BrowserWindow,
  type WebContents,
  type Session,
} from "electron";
import { NativeBrowserOverlays, type OverlayBrowser } from "./overlays.js";
import { createNativeBrowserSurface } from "./capture.js";
import {
  registerOwnedPaseoBrowser,
  unregisterPaseoBrowserFromHost,
} from "../browser-webviews/index.js";
import { isAllowedBrowserWebviewUrl } from "../browser-webviews/window-open.js";
import { registerNativeBrowserSurface } from "./surfaces.js";
import {
  BROWSER_VIEW_STATE_EVENT,
  BROWSER_VIEW_OVERLAY_INVALIDATED_EVENT,
  type NativeBrowserOverlayTarget,
  type NativeBrowserOverlayFrame,
  type NativeBrowserViewState,
} from "./contracts.js";

interface OwnedView {
  readonly view: WebContentsView;
  readonly host: BrowserWindow;
  readonly hostId: number;
  readonly browserId: string;
  readonly workspaceId: string;
  visible: boolean;
  revision: number;
  geometry: string;
  lastError: string | null;
  faviconUrl: string | null;
  clipView?: View;
  retireSurface(): void;
}
export interface BrowserViewOwnerDependencies {
  profile(): Session;
  preloadPath(): string;
  prepare(contents: WebContents, host: BrowserWindow): void;
  /** Tests inject a focused native port; production uses Electron directly. */
  createView?: (options: Electron.WebContentsViewConstructorOptions) => WebContentsView;
  createClipView?: () => View;
}

/** Own native pages independently of renderer component mounting and selection.
 * A registered application window is the only caller identity that can create,
 * present or control its pages. Hiding a pane never closes its document/profile.
 */
export class NativeBrowserViewOwner {
  private readonly hosts = new Map<number, BrowserWindow>();
  private readonly views = new Map<string, OwnedView>();
  private readonly overlays = new NativeBrowserOverlays(
    () => this.views.values(),
    (target) => this.applyOverlayVisibility(target),
  );
  public constructor(private readonly dependencies: BrowserViewOwnerDependencies) {}

  /** Admit only actual Paseo application windows, before their renderer loads. */
  public registerHost(host: BrowserWindow): void {
    const id = host.webContents.id;
    this.hosts.set(id, host);
    host.once("closed", () => {
      this.hosts.delete(id);
      this.overlays.clearHost(id);
      for (const owned of this.views.values()) {
        if (owned.host === host) this.dispose(owned);
      }
    });
    host.webContents.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => {
      if (!isMainFrame || isInPlace) return;
      // Reloading the UI retires its presentation, not its independent documents.
      this.hideHostViews(host);
    });
    // A failed UI renderer cannot leave an interactive native surface over recovery UI.
    host.webContents.on("render-process-gone", () => this.hideHostViews(host));
  }

  /** Retire presentation while preserving independently owned page documents. */
  private hideHostViews(host: BrowserWindow): void {
    this.overlays.clearHost(host.webContents.id);
    for (const owned of this.views.values()) {
      if (owned.host === host && !owned.view.webContents.isDestroyed()) {
        this.invalidateOverlay(owned);
        owned.visible = false;
        owned.view.setVisible(false);
      }
    }
  }

  /** Create once per host/browser identity; navigation is an explicit later command. */
  public create(
    hostId: number,
    input: { browserId: string; workspaceId: string; url: string },
  ): NativeBrowserViewState {
    const host = this.hosts.get(hostId);
    if (!host || host.isDestroyed())
      throw new Error("Browser view caller is not an application host");
    const key = this.key(hostId, input.browserId);
    const existing = this.views.get(key);
    if (existing) {
      if (existing.workspaceId !== input.workspaceId)
        throw new Error("Browser view workspace identity changed");
      return this.state(existing);
    }
    if (!isAllowedBrowserWebviewUrl(input.url)) throw new Error("Browser view URL is not allowed");
    const profile = this.dependencies.profile();
    const createView =
      this.dependencies.createView ??
      ((options: Electron.WebContentsViewConstructorOptions) => new WebContentsView(options));
    const view = createView({
      webPreferences: {
        session: profile,
        preload: this.dependencies.preloadPath(),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: true,
        nodeIntegrationInWorker: false,
        webviewTag: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        focusOnNavigation: false,
        backgroundThrottling: false,
      },
    });
    view.setVisible(false);
    view.setBounds({ x: 0, y: 0, width: 1280, height: 800 });
    const owned: OwnedView = {
      view,
      host,
      hostId,
      ...input,
      visible: false,
      revision: 0,
      geometry: "",
      lastError: null,
      faviconUrl: null,
      retireSurface: () => {},
    };
    try {
      if (
        !registerOwnedPaseoBrowser({
          contents: view.webContents,
          view,
          hostContents: host.webContents,
          profileSession: profile,
          browserId: input.browserId,
          workspaceId: input.workspaceId,
        })
      ) {
        throw new Error("Native browser registration rejected");
      }
      this.views.set(key, owned);
      host.contentView.addChildView(view);
      this.dependencies.prepare(view.webContents, host);
      this.observe(owned);
      owned.retireSurface = registerNativeBrowserSurface(
        view.webContents.id,
        createNativeBrowserSurface(view, () => this.isPresented(owned)),
      );
      void this.navigate(hostId, input.browserId, input.url).catch((error) => {
        if (view.webContents.isDestroyed()) return;
        owned.lastError = String(error);
        this.publish(owned);
      });
      return this.state(owned);
    } catch (error) {
      this.dispose(owned);
      throw error;
    }
  }

  /** Convert host CSS origin/clip to DIP and preserve independent page CSS presets.
   * Fixed presets retain their full dimensions; their visible region clips at the
   * pane boundary. No device emulation or image presentation is used here.
   */
  public present(
    hostId: number,
    input: {
      browserId: string;
      visible: boolean;
      viewportMode: "fixed" | "responsive";
      bounds: { x: number; y: number; width: number; height: number };
      clip?: { x: number; y: number; width: number; height: number };
    },
  ): NativeBrowserViewState {
    const owned = this.get(hostId, input.browserId);
    const hostZoom = owned.host.webContents.getZoomFactor();
    const extentZoom =
      input.viewportMode === "fixed" ? owned.view.webContents.getZoomFactor() : hostZoom;
    const viewportInDip = {
      width: Math.max(1, Math.round(input.bounds.width * extentZoom)),
      height: Math.max(1, Math.round(input.bounds.height * extentZoom)),
    };
    // A hidden viewport must still intersect its native ancestors when capture
    // primes it. Reusing a centered pane offset after shrinking the viewport can
    // put the entire native widget outside its clip and leave renderer size stale.
    if (!input.visible) owned.view.setVisible(false);
    const bounds = input.visible ? input.bounds : { ...input.bounds, x: 0, y: 0 };
    const clip = input.visible ? (input.clip ?? bounds) : bounds;
    // Convert each edge in its own coordinate space, then round once. Hidden
    // ancestors intersect the entire native viewport regardless of host UI zoom.
    const originInDip = {
      x: input.visible ? Math.round(bounds.x * hostZoom) : 0,
      y: input.visible ? Math.round(bounds.y * hostZoom) : 0,
    };
    const nearX = Math.ceil(clip.x * hostZoom);
    const nearY = Math.ceil(clip.y * hostZoom);
    const clipBoundsInHostDip =
      input.visible && input.clip
        ? {
            x: nearX,
            y: nearY,
            width: Math.max(1, Math.floor((clip.x + clip.width) * hostZoom) - nearX),
            height: Math.max(1, Math.floor((clip.y + clip.height) * hostZoom) - nearY),
          }
        : { ...originInDip, ...viewportInDip };
    if (input.clip && !owned.clipView) {
      const parent = this.dependencies.createClipView?.() ?? new View();
      parent.setBounds(clipBoundsInHostDip);
      owned.host.contentView.addChildView(parent);
      // Move directly between attached parents in the same native widget. Explicit
      // removal first detaches the subtree and orphans its native layers.
      parent.addChildView(owned.view);
      owned.clipView = parent;
    } else {
      owned.clipView?.setBounds(clipBoundsInHostDip);
    }
    const nativeBounds = {
      x: originInDip.x - (owned.clipView ? clipBoundsInHostDip.x : 0),
      y: originInDip.y - (owned.clipView ? clipBoundsInHostDip.y : 0),
      ...viewportInDip,
    };
    const geometry = JSON.stringify([
      nativeBounds,
      clipBoundsInHostDip,
      input.visible,
      hostZoom,
      extentZoom,
    ]);
    if (geometry !== owned.geometry) {
      owned.geometry = geometry;
      this.invalidateOverlay(owned);
    }
    owned.view.setBounds(nativeBounds);
    owned.visible = input.visible;
    owned.view.setVisible(this.isPresented(owned));
    return this.state(owned);
  }

  /** Prepare current frames before full-window suppression. */
  public prepareOverlay(hostId: number, token: string): NativeBrowserOverlayTarget[] {
    this.assertHost(hostId);
    return this.overlays.prepare(hostId, token);
  }

  /** Validate prepared frame identities and hide before interactive DOM admission. */
  public commitOverlay(
    hostId: number,
    token: string,
    frames: NativeBrowserOverlayTarget[],
  ): boolean {
    this.assertHost(hostId);
    return this.overlays.commit(hostId, token, frames);
  }

  /** Capture only a target admitted by this exact host/token/revision. */
  public captureOverlay(
    hostId: number,
    token: string,
    target: NativeBrowserOverlayTarget,
  ): Promise<NativeBrowserOverlayFrame | null> {
    this.assertHost(hostId);
    this.assertTarget(hostId, target.browserId, target.webContentsId);
    return this.overlays.capture(hostId, token, target);
  }

  /** Restore requested presentation without selecting, activating or focusing a tab. */
  public endOverlay(hostId: number, token: string): void {
    this.assertHost(hostId);
    this.overlays.end(hostId, token);
  }

  private assertHost(hostId: number): void {
    const host = this.hosts.get(hostId);
    if (!host || host.isDestroyed())
      throw new Error("Browser overlay caller is not an application host");
  }

  private isPresented(owned: OverlayBrowser): boolean {
    return owned.visible && !this.overlays.isSuppressed(owned);
  }

  private applyOverlayVisibility(target: OverlayBrowser): void {
    const owned = this.views.get(this.key(target.hostId, target.browserId));
    if (owned !== target || owned.host.isDestroyed() || owned.view.webContents.isDestroyed())
      return;
    owned.view.setVisible(this.isPresented(owned));
    this.publish(owned);
  }

  /** Retire pending pixels before navigation/layout/closure changes their meaning. */
  private invalidateOverlay(owned: OwnedView): void {
    owned.revision++;
    this.overlays.invalidate(owned);
    if (!owned.host.isDestroyed() && !owned.host.webContents.isDestroyed()) {
      owned.host.webContents.send(BROWSER_VIEW_OVERLAY_INVALIDATED_EVENT, {
        browserId: owned.browserId,
        webContentsId: owned.view.webContents.id,
        revision: owned.revision,
      });
    }
  }

  /** Fence an old renderer session before it can mutate a replacement document. */
  public assertTarget(hostId: number, browserId: string, contentsId: number): void {
    if (this.get(hostId, browserId).view.webContents.id !== contentsId) {
      throw new Error("Native browser target was replaced");
    }
  }

  /** Report ownership without granting a caller access to another host's surface. */
  public owns(hostId: number, browserId: string): boolean {
    return this.views.has(this.key(hostId, browserId));
  }

  /** Focus only an explicitly presented view whose owning window already has focus. */
  public focus(hostId: number, browserId: string): boolean {
    const owned = this.get(hostId, browserId);
    if (
      !this.isPresented(owned) ||
      !owned.host.isFocused() ||
      owned.host.isMinimized() ||
      !owned.host.isVisible()
    )
      return false;
    owned.view.webContents.focus();
    return true;
  }

  /** Navigate only the addressed owned target; background navigation never selects it. */
  public async navigate(hostId: number, browserId: string, url: string): Promise<void> {
    if (!isAllowedBrowserWebviewUrl(url)) throw new Error("Browser view URL is not allowed");
    await this.get(hostId, browserId).view.webContents.loadURL(url);
  }
  /** Run existing selector/annotation scripts only in the caller's exact native page. */
  public async executeScript(hostId: number, browserId: string, code: string): Promise<unknown> {
    return this.get(hostId, browserId).view.webContents.executeJavaScript(code);
  }
  /** Dispatch only browser navigation controls, never operating-system shortcuts. */
  public control(
    hostId: number,
    browserId: string,
    command: "back" | "forward" | "reload" | "stop",
  ): NativeBrowserViewState {
    const owned = this.get(hostId, browserId);
    const contents = owned.view.webContents;
    if (command === "back" && contents.navigationHistory.canGoBack())
      contents.navigationHistory.goBack();
    if (command === "forward" && contents.navigationHistory.canGoForward())
      contents.navigationHistory.goForward();
    if (command === "reload") contents.reload();
    if (command === "stop") contents.stop();
    return this.state(owned);
  }
  /** Refresh a renderer proxy from authoritative, owner-scoped page state. */
  public snapshot(hostId: number, browserId: string): NativeBrowserViewState {
    return this.state(this.get(hostId, browserId));
  }

  /** Renderer teardown hides a page; explicit tab close is the destruction boundary. */
  public close(hostId: number, browserId: string): void {
    this.dispose(this.get(hostId, browserId));
  }
  /** Reject stale/foreign identities before any native operation or state observation. */
  private get(hostId: number, browserId: string): OwnedView {
    const owned = this.views.get(this.key(hostId, browserId));
    if (!owned || owned.host.isDestroyed() || owned.view.webContents.isDestroyed())
      throw new Error("Native browser target is unavailable to this host");
    return owned;
  }
  private key(hostId: number, browserId: string): string {
    return `${hostId}:${browserId}`;
  }
  private state(owned: OwnedView): NativeBrowserViewState {
    const contents = owned.view.webContents;
    return {
      browserId: owned.browserId,
      workspaceId: owned.workspaceId,
      webContentsId: contents.id,
      url: contents.getURL(),
      title: contents.getTitle(),
      faviconUrl: owned.faviconUrl,
      isLoading: contents.isLoading(),
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(),
      visible: this.isPresented(owned),
      presentationScale: contents.getZoomFactor() / owned.host.webContents.getZoomFactor(),
      focused: this.isPresented(owned) && owned.host.isFocused() && contents.isFocused(),
      lastError: owned.lastError,
    };
  }
  /** Publish authoritative state only to the owning trusted host renderer. */
  private publish(owned: OwnedView): void {
    if (
      !owned.host.isDestroyed() &&
      !owned.host.webContents.isDestroyed() &&
      !owned.view.webContents.isDestroyed()
    ) {
      owned.host.webContents.send(BROWSER_VIEW_STATE_EVENT, this.state(owned));
    }
  }
  /** Keep subscriptions with the actual contents, not the UI component lifetime. */
  private observe(owned: OwnedView): void {
    const contents = owned.view.webContents;
    const publish = () => this.publish(owned);
    contents.on("did-start-navigation", (_event, _url, _isInPlace, isMainFrame) => {
      if (isMainFrame) this.invalidateOverlay(owned);
    });
    contents.on("did-stop-loading", publish);
    const navigation = () => {
      this.invalidateOverlay(owned);
      this.publish(owned);
    };
    contents.on("did-navigate", navigation);
    contents.on("did-navigate-in-page", navigation);
    contents.on("page-title-updated", publish);
    contents.on("focus", publish);
    contents.on("blur", publish);
    contents.on("did-fail-load", (_event, code, description, _url, isMainFrame) => {
      if (!isMainFrame || code === -3) return;
      owned.lastError = description;
      this.publish(owned);
    });
    contents.on("did-start-loading", () => {
      owned.lastError = null;
      this.publish(owned);
    });
    contents.on("page-favicon-updated", (_event, favicons) => {
      owned.faviconUrl = favicons[0] ?? null;
      this.publish(owned);
    });
    contents.once("destroyed", () => {
      this.invalidateOverlay(owned);
      owned.retireSurface();
      if (this.views.get(this.key(owned.hostId, owned.browserId)) === owned) {
        this.views.delete(this.key(owned.hostId, owned.browserId));
      }
    });
  }
  /** Retire exactly this native surface and contents; no tab recreation or profile mutation. */
  private dispose(owned: OwnedView): void {
    this.invalidateOverlay(owned);
    const hostId = owned.hostId;
    if (this.views.get(this.key(hostId, owned.browserId)) === owned)
      this.views.delete(this.key(hostId, owned.browserId));
    owned.retireSurface();
    if (!owned.host.isDestroyed()) {
      owned.host.contentView.removeChildView(owned.clipView ?? owned.view);
    }
    owned.clipView?.removeChildView(owned.view);
    if (!owned.view.webContents.isDestroyed())
      owned.view.webContents.close({ waitForBeforeUnload: false });
    unregisterPaseoBrowserFromHost(hostId, owned.browserId);
  }
}
