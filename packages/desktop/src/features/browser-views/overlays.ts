import type { BrowserWindow, View, WebContentsView } from "electron";
import { getNativeBrowserSurface } from "./surfaces.js";
import type { NativeBrowserOverlayFrame, NativeBrowserOverlayTarget } from "./contracts.js";

/** The requested presentation survives temporary overlay suppression. */
export interface OverlayBrowser {
  readonly browserId: string;
  readonly hostId: number;
  readonly host: BrowserWindow;
  readonly view: WebContentsView;
  readonly clipView?: View;
  readonly visible: boolean;
  readonly revision: number;
}
interface Snapshot {
  readonly target: OverlayBrowser;
  readonly identity: NativeBrowserOverlayTarget;
  readonly rect: Electron.Rectangle;
  readonly bounds: Electron.Rectangle;
  readonly abort: AbortController;
  started: boolean;
}
interface Lease {
  readonly snapshots: Map<string, Snapshot>;
}

/** Hide native pages for a full-window DOM overlay, independently of tab lifetime.
 * One canonical overlay registration owns one token. Nested registrations retain
 * suppression until the last token ends. Frames are disposable, never a cache.
 */
export class NativeBrowserOverlays {
  private readonly hosts = new Map<number, Map<string, Lease>>();

  public constructor(
    private readonly targets: () => Iterable<OverlayBrowser>,
    private readonly applyVisibility: (target: OverlayBrowser) => void,
  ) {}

  public isSuppressed(target: OverlayBrowser): boolean {
    // MenuOverlay includes a full-window interactive backdrop. Suppress requested
    // presentations even when their old bounds are outside the host: resizing the
    // window must not reveal them before the next renderer geometry command.
    return (this.hosts.get(target.hostId)?.size ?? 0) > 0;
  }

  /** Hide synchronously before acknowledging admission of interactive DOM content. */
  public begin(hostId: number, token: string): NativeBrowserOverlayTarget[] {
    const leases = this.hosts.get(hostId) ?? new Map<string, Lease>();
    const existing = leases.get(token);
    if (existing) return [...existing.snapshots.values()].map((snapshot) => snapshot.identity);
    if (leases.size >= 64) throw new Error("Too many native browser overlays");
    const snapshots = new Map<string, Snapshot>();
    for (const target of this.targets()) {
      if (target.hostId !== hostId || !target.visible || target.host.isDestroyed()) continue;
      if (!target.host.isVisible() || target.host.isMinimized()) continue;
      const snapshot = this.snapshot(target);
      if (snapshot) snapshots.set(target.browserId, snapshot);
    }
    leases.set(token, { snapshots });
    this.hosts.set(hostId, leases);
    this.refresh(hostId);
    return [...snapshots.values()].map((snapshot) => snapshot.identity);
  }

  /** Attempt one current frame, after hide acknowledgement. Failure admits blank.
   * Aborting a timed-out capture does not release the existing native queue early.
   * Its active operation retains ownership until Electron settles it.
   */
  public async capture(
    hostId: number,
    token: string,
    identity: NativeBrowserOverlayTarget,
  ): Promise<NativeBrowserOverlayFrame | null> {
    const lease = this.hosts.get(hostId)?.get(token);
    const snapshot = lease?.snapshots.get(identity.browserId);
    if (
      !snapshot ||
      snapshot.started ||
      snapshot.identity.webContentsId !== identity.webContentsId ||
      snapshot.identity.revision !== identity.revision ||
      !this.isCurrent(hostId, token, snapshot)
    )
      return null;
    snapshot.started = true;
    const surface = getNativeBrowserSurface(identity.webContentsId);
    if (!surface) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          snapshot.abort.abort();
          resolve(null);
        }, 250);
      });
      const image = await Promise.race([
        surface.capture(snapshot.abort.signal, snapshot.rect),
        timeout,
      ]);
      if (!image || !this.isCurrent(hostId, token, snapshot)) return null;
      const size = image.getSize();
      if (size.width <= 0 || size.height <= 0) return null;
      const png = image.toPNG();
      // Bound bridge memory. A large image is an approved blank fallback, not a
      // reason to resample the actual browser or reuse pixels from an old page.
      if (png.length === 0 || png.length > 8 * 1024 * 1024) return null;
      return {
        ...snapshot.identity,
        bounds: snapshot.bounds,
        dataUrl: `data:image/png;base64,${Buffer.from(png).toString("base64")}`,
      };
    } catch {
      return null;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /** Release one registration without restoring over another overlay or a closed tab. */
  public end(hostId: number, token: string): void {
    const leases = this.hosts.get(hostId);
    const lease = leases?.get(token);
    if (!lease) return;
    for (const snapshot of lease.snapshots.values()) snapshot.abort.abort();
    leases?.delete(token);
    if (leases?.size === 0) this.hosts.delete(hostId);
    this.refresh(hostId);
  }

  /** Navigation, account/target changes and layout make every pending frame unusable. */
  public invalidate(target: OverlayBrowser): void {
    for (const lease of this.hosts.get(target.hostId)?.values() ?? []) {
      const snapshot = lease.snapshots.get(target.browserId);
      if (!snapshot || snapshot.target !== target) continue;
      snapshot.abort.abort();
      lease.snapshots.delete(target.browserId);
    }
  }

  /** UI reload/crash retires tokens without re-presenting the failed UI's pages. */
  public clearHost(hostId: number): void {
    const leases = this.hosts.get(hostId);
    this.hosts.delete(hostId);
    for (const lease of leases?.values() ?? []) {
      for (const snapshot of lease.snapshots.values()) snapshot.abort.abort();
    }
  }

  private isCurrent(hostId: number, token: string, snapshot: Snapshot): boolean {
    const target = snapshot.target;
    return (
      this.hosts.get(hostId)?.get(token)?.snapshots.get(target.browserId) === snapshot &&
      !snapshot.abort.signal.aborted &&
      !target.host.isDestroyed() &&
      !target.view.webContents.isDestroyed() &&
      target.visible &&
      target.revision === snapshot.identity.revision
    );
  }

  private refresh(hostId: number): void {
    for (const target of this.targets()) {
      if (target.hostId === hostId && target.visible) this.applyVisibility(target);
    }
  }

  /** Native bounds/crop use DIP. Placeholder bounds convert to host CSS once. */
  private viewport(
    target: OverlayBrowser,
  ): { rect: Electron.Rectangle; bounds: Electron.Rectangle } | null {
    const child = target.view.getBounds();
    const parent = target.clipView?.getBounds();
    const host = target.host.getContentBounds();
    const origin = { x: child.x + (parent?.x ?? 0), y: child.y + (parent?.y ?? 0) };
    const x = Math.max(0, origin.x, parent?.x ?? 0);
    const y = Math.max(0, origin.y, parent?.y ?? 0);
    const right = Math.min(
      host.width,
      origin.x + child.width,
      parent ? parent.x + parent.width : Infinity,
    );
    const bottom = Math.min(
      host.height,
      origin.y + child.height,
      parent ? parent.y + parent.height : Infinity,
    );
    if (right <= x || bottom <= y) return null;
    const zoom = target.host.webContents.getZoomFactor();
    return {
      rect: { x: x - origin.x, y: y - origin.y, width: right - x, height: bottom - y },
      bounds: { x: x / zoom, y: y / zoom, width: (right - x) / zoom, height: (bottom - y) / zoom },
    };
  }

  private snapshot(target: OverlayBrowser): Snapshot | null {
    const viewport = this.viewport(target);
    if (!viewport) return null;
    return {
      ...viewport,
      target,
      identity: {
        browserId: target.browserId,
        webContentsId: target.view.webContents.id,
        revision: target.revision,
      },
      abort: new AbortController(),
      started: false,
    };
  }
}
