import { EventEmitter } from "node:events";
import type { BrowserWindow, WebContentsView, Session, View } from "electron";
import { registerNativeBrowserSurface } from "../browser-views/surfaces.js";
import { NativeBrowserViewOwner } from "../browser-views/owner.js";
import {
  BrowserViewIdentitySchema,
  BrowserViewPresentationSchema,
  CreateBrowserViewSchema,
} from "../browser-views/contracts.js";
import { describe, expect, test, vi } from "vitest";
import { PASEO_BROWSER_PROFILE_PARTITION } from "../browser-profile.js";
import {
  getPaseoBrowserIdForWebContents,
  getPaseoBrowserWebviewRegistry,
  getPaseoBrowserWorkspaceId,
  isPaseoBrowserWebviewAttach,
  preparePaseoBrowserWebContents,
  isPreparedPaseoBrowserWebContents,
  registerAttachedPaseoBrowser,
  registerOwnedPaseoBrowser,
  unregisterPaseoBrowser,
  unregisterPaseoBrowserFromHost,
} from "./index.js";

class FakeRenderer {
  public constructor(public readonly id: number) {}

  public isDestroyed(): boolean {
    return false;
  }
}

class FakeBrowserGuest {
  private destroyedListener: (() => void) | null = null;
  private destroyed = false;

  public constructor(
    public readonly id: number,
    public readonly hostWebContents: FakeRenderer | null,
    public readonly session: object,
  ) {}

  public isDestroyed(): boolean {
    return this.destroyed;
  }

  public once(event: "destroyed", listener: () => void): void {
    expect(event).toBe("destroyed");
    this.destroyedListener = listener;
  }

  public destroy(): void {
    this.destroyed = true;
    this.destroyedListener?.();
  }
}

describe("browser webview attachment", () => {
  test("tracks accepted guest preparation only until its actual destruction", () => {
    const guest = new FakeBrowserGuest(9901, new FakeRenderer(9900), {});
    expect(isPreparedPaseoBrowserWebContents(guest)).toBe(false);
    preparePaseoBrowserWebContents(guest);
    expect(isPreparedPaseoBrowserWebContents(guest)).toBe(true);
    guest.destroy();
    expect(isPreparedPaseoBrowserWebContents(guest)).toBe(false);
  });
  test("accepts only allowed URLs on the shared profile partition", () => {
    expect(
      isPaseoBrowserWebviewAttach({
        src: "https://example.com",
        partition: PASEO_BROWSER_PROFILE_PARTITION,
      }),
    ).toBe(true);
    expect(
      isPaseoBrowserWebviewAttach({
        src: "https://example.com",
        partition: "persist:paseo-browser-tab-a",
      }),
    ).toBe(false);
    expect(
      isPaseoBrowserWebviewAttach({ src: "https://example.com", partition: "persist:foreign" }),
    ).toBe(false);
  });

  test("binds explicit browser identity to the renderer that hosts the guest", () => {
    const profileSession = {};
    const renderer = new FakeRenderer(1);
    const guest = new FakeBrowserGuest(101, renderer, profileSession);

    const registered = registerAttachedPaseoBrowser({
      browserId: "browser-a",
      workspaceId: "workspace-a",
      webContentsId: guest.id,
      sender: renderer,
      profileSession,
      findWebContents: () => guest,
    });

    expect(registered).toBe(true);
    expect(getPaseoBrowserIdForWebContents(guest)).toBe("browser-a");
    expect(getPaseoBrowserWorkspaceId("browser-a")).toBe("workspace-a");
    unregisterPaseoBrowser("browser-a");
  });

  test("rejects a guest hosted by another renderer", () => {
    const profileSession = {};
    const owner = new FakeRenderer(1);
    const claimant = new FakeRenderer(2);
    const guest = new FakeBrowserGuest(201, owner, profileSession);

    const registered = registerAttachedPaseoBrowser({
      browserId: "browser-rejected-owner",
      workspaceId: "workspace-a",
      webContentsId: guest.id,
      sender: claimant,
      profileSession,
      findWebContents: () => guest,
    });

    expect(registered).toBe(false);
    expect(getPaseoBrowserIdForWebContents(guest)).toBeNull();
  });

  test("rejects a guest outside the shared profile", () => {
    const profileSession = {};
    const renderer = new FakeRenderer(1);
    const guest = new FakeBrowserGuest(301, renderer, {});

    const registered = registerAttachedPaseoBrowser({
      browserId: "browser-rejected-profile",
      workspaceId: "workspace-a",
      webContentsId: guest.id,
      sender: renderer,
      profileSession,
      findWebContents: () => guest,
    });

    expect(registered).toBe(false);
    expect(getPaseoBrowserIdForWebContents(guest)).toBeNull();
  });

  test("concurrent windows cannot swap browser identities", () => {
    const profileSession = {};
    const firstRenderer = new FakeRenderer(1);
    const secondRenderer = new FakeRenderer(2);
    const firstGuest = new FakeBrowserGuest(401, firstRenderer, profileSession);
    const secondGuest = new FakeBrowserGuest(402, secondRenderer, profileSession);
    const guests = new Map([
      [firstGuest.id, firstGuest],
      [secondGuest.id, secondGuest],
    ]);

    registerAttachedPaseoBrowser({
      browserId: "browser-second",
      workspaceId: "workspace-second",
      webContentsId: secondGuest.id,
      sender: secondRenderer,
      profileSession,
      findWebContents: (id) => guests.get(id) ?? null,
    });
    registerAttachedPaseoBrowser({
      browserId: "browser-first",
      workspaceId: "workspace-first",
      webContentsId: firstGuest.id,
      sender: firstRenderer,
      profileSession,
      findWebContents: (id) => guests.get(id) ?? null,
    });

    expect(getPaseoBrowserIdForWebContents(firstGuest)).toBe("browser-first");
    expect(getPaseoBrowserIdForWebContents(secondGuest)).toBe("browser-second");
    unregisterPaseoBrowser("browser-first");
    unregisterPaseoBrowser("browser-second");
  });

  test("unregisters the same browser only from its requesting host", () => {
    const profileSession = {};
    const firstRenderer = new FakeRenderer(11);
    const secondRenderer = new FakeRenderer(22);
    const firstGuest = new FakeBrowserGuest(501, firstRenderer, profileSession);
    const secondGuest = new FakeBrowserGuest(502, secondRenderer, profileSession);

    for (const [renderer, guest] of [
      [firstRenderer, firstGuest],
      [secondRenderer, secondGuest],
    ] as const) {
      registerAttachedPaseoBrowser({
        browserId: "browser-shared-hosts",
        workspaceId: "workspace-shared",
        webContentsId: guest.id,
        sender: renderer,
        profileSession,
        findWebContents: () => guest,
      });
    }

    unregisterPaseoBrowserFromHost(firstRenderer.id, "browser-shared-hosts");

    expect(getPaseoBrowserIdForWebContents(firstGuest)).toBeNull();
    expect(getPaseoBrowserIdForWebContents(secondGuest)).toBe("browser-shared-hosts");
    expect(getPaseoBrowserWorkspaceId("browser-shared-hosts")).toBe("workspace-shared");
    unregisterPaseoBrowser("browser-shared-hosts");
  });

  test("removes registration when the guest is destroyed", () => {
    const profileSession = {};
    const renderer = new FakeRenderer(31);
    const guest = new FakeBrowserGuest(601, renderer, profileSession);
    preparePaseoBrowserWebContents(guest);
    registerAttachedPaseoBrowser({
      browserId: "browser-cleanup",
      workspaceId: "workspace-cleanup",
      webContentsId: guest.id,
      sender: renderer,
      profileSession,
      findWebContents: () => guest,
    });

    expect(getPaseoBrowserIdForWebContents(guest)).toBe("browser-cleanup");

    guest.destroy();

    expect(getPaseoBrowserIdForWebContents(guest)).toBeNull();
  });
});

/** Native views are owned by main, without Electron's webview host pointer. */
class FakeNativeBrowser extends FakeBrowserGuest {
  public constructor(id: number, profile: object) {
    super(id, null, profile);
  }

  public getType(): string {
    return "window";
  }
}

describe("main-owned native browser identity", () => {
  test("native admission commits extension identity and selection events through destruction", async () => {
    const profile = {};
    const host = new FakeRenderer(9970);
    const contents = new FakeNativeBrowser(9971, profile);
    const registry = getPaseoBrowserWebviewRegistry();
    const events: unknown[] = [];
    const unsubscribe = registry.subscribe((event) => events.push(event));
    const registration = registry.waitForRegistration(contents.id);

    try {
      expect(isPreparedPaseoBrowserWebContents(contents)).toBe(false);
      expect(
        registerOwnedPaseoBrowser({
          browserId: "native-extension-lifecycle",
          workspaceId: "extension-lifecycle-workspace",
          contents,
          view: { webContents: contents },
          hostContents: host,
          profileSession: profile,
        }),
      ).toBe(true);
      await expect(registration).resolves.toEqual({
        browserId: "native-extension-lifecycle",
        hostWebContentsId: host.id,
      });
      expect(isPreparedPaseoBrowserWebContents(contents)).toBe(true);

      registry.setWorkspaceActiveBrowser({
        hostWebContentsId: host.id,
        workspaceId: "extension-lifecycle-workspace",
        browserId: "native-extension-lifecycle",
      });
      contents.destroy();

      expect(events).toEqual([
        {
          type: "registered",
          webContentsId: contents.id,
          browserId: "native-extension-lifecycle",
          hostWebContentsId: host.id,
        },
        {
          type: "active-changed",
          hostWebContentsId: host.id,
          previousWebContentsId: null,
          webContentsId: contents.id,
        },
        {
          type: "unregistered",
          webContentsId: contents.id,
          browserId: "native-extension-lifecycle",
          hostWebContentsId: host.id,
        },
        {
          type: "active-changed",
          hostWebContentsId: host.id,
          previousWebContentsId: contents.id,
          webContentsId: null,
        },
      ]);
      expect(isPreparedPaseoBrowserWebContents(contents)).toBe(false);
      expect(registry.getRegistrationForWebContents(contents.id)).toBeNull();
    } finally {
      unsubscribe();
      contents.destroy();
      unregisterPaseoBrowser("native-extension-lifecycle");
    }
  });

  test("a window-typed target cannot substitute for the creator's actual view contents", () => {
    const profile = {};
    const contents = new FakeNativeBrowser(9981, profile);
    expect(
      registerOwnedPaseoBrowser({
        browserId: "substituted-native",
        workspaceId: "workspace",
        contents,
        view: { webContents: new FakeNativeBrowser(9982, profile) },
        hostContents: new FakeRenderer(9980),
        profileSession: profile,
      }),
    ).toBe(false);
    expect(getPaseoBrowserIdForWebContents(contents)).toBeNull();
  });
  test("preserves explicit workspace identity and retires preparation on destruction", () => {
    const profile = {};
    const host = new FakeRenderer(9910);
    const contents = new FakeNativeBrowser(9911, profile);
    expect(
      registerOwnedPaseoBrowser({
        browserId: "native-owned",
        workspaceId: "native-workspace",
        contents,
        view: { webContents: contents },
        hostContents: host,
        profileSession: profile,
      }),
    ).toBe(true);
    expect(getPaseoBrowserIdForWebContents(contents)).toBe("native-owned");
    expect(getPaseoBrowserWorkspaceId("native-owned")).toBe("native-workspace");
    expect(isPreparedPaseoBrowserWebContents(contents)).toBe(true);
    contents.destroy();
    expect(getPaseoBrowserIdForWebContents(contents)).toBeNull();
    expect(isPreparedPaseoBrowserWebContents(contents)).toBe(false);
    unregisterPaseoBrowser("native-owned");
  });

  test("renderer attachment cannot claim a main-owned native view", () => {
    const profile = {};
    const owner = new FakeRenderer(9920);
    const claimant = new FakeRenderer(9921);
    const contents = new FakeNativeBrowser(9922, profile);
    registerOwnedPaseoBrowser({
      browserId: "native-private",
      workspaceId: "native-workspace",
      contents,
      view: { webContents: contents },
      hostContents: owner,
      profileSession: profile,
    });
    expect(
      registerAttachedPaseoBrowser({
        browserId: "renderer-claim",
        workspaceId: "foreign-workspace",
        webContentsId: contents.id,
        sender: claimant,
        profileSession: profile,
        findWebContents: () => contents,
      }),
    ).toBe(false);
    expect(getPaseoBrowserIdForWebContents(contents)).toBe("native-private");
    expect(getPaseoBrowserWorkspaceId("renderer-claim")).toBeNull();
    contents.destroy();
    unregisterPaseoBrowser("native-private");
  });

  test("foreign profiles are not prepared for extension or automation access", () => {
    const contents = new FakeNativeBrowser(9931, {});
    expect(
      registerOwnedPaseoBrowser({
        browserId: "native-foreign-profile",
        workspaceId: "native-workspace",
        contents,
        view: { webContents: contents },
        hostContents: new FakeRenderer(9930),
        profileSession: {},
      }),
    ).toBe(false);
    expect(isPreparedPaseoBrowserWebContents(contents)).toBe(false);
    expect(getPaseoBrowserIdForWebContents(contents)).toBeNull();
  });

  test("a destroyed host cannot publish a native browser", () => {
    const profile = {};
    const contents = new FakeNativeBrowser(9941, profile);
    expect(
      registerOwnedPaseoBrowser({
        browserId: "native-dead-host",
        workspaceId: "native-workspace",
        contents,
        view: { webContents: contents },
        hostContents: { id: 9940, isDestroyed: () => true },
        profileSession: profile,
      }),
    ).toBe(false);
    expect(isPreparedPaseoBrowserWebContents(contents)).toBe(false);
    expect(getPaseoBrowserIdForWebContents(contents)).toBeNull();
  });
});

/** Focused native ports test main ownership without launching a browser. */
function nativeOwnerFixture() {
  const profile = {} as Session;
  class Contents extends EventEmitter {
    public readonly session = profile;
    public url = "about:blank";
    public destroyed = false;
    public readonly focus = vi.fn();
    public readonly navigationHistory = {
      canGoBack: () => false,
      canGoForward: () => false,
      goBack: vi.fn(),
      goForward: vi.fn(),
    };
    public constructor(public readonly id: number) {
      super();
    }
    public getType(): string {
      return "window";
    }
    public isDestroyed(): boolean {
      return this.destroyed;
    }
    public isFocused(): boolean {
      return false;
    }
    public getURL(): string {
      return this.url;
    }
    public getTitle(): string {
      return "Native test page";
    }
    public zoomFactor = 1;
    public getZoomFactor(): number {
      return this.zoomFactor;
    }
    public isLoading(): boolean {
      return false;
    }
    public async loadURL(url: string): Promise<void> {
      this.url = url;
    }
    public close(): void {
      this.destroyed = true;
      this.emit("destroyed");
    }
    public reload = vi.fn();
    public stop = vi.fn();
    public send = vi.fn();
  }
  class Host extends EventEmitter {
    public readonly webContents = new Contents(9950);
    public focused = false;
    public destroyed = false;
    public readonly contentView = { addChildView: vi.fn(), removeChildView: vi.fn() };
    public isDestroyed(): boolean {
      return this.destroyed;
    }
    public isFocused(): boolean {
      return this.focused;
    }
    public isMinimized(): boolean {
      return false;
    }
    public isVisible(): boolean {
      return true;
    }
    public getContentBounds(): Electron.Rectangle {
      return { x: 0, y: 0, width: 1000, height: 800 };
    }
  }
  const host = new Host();
  let bounds: Electron.Rectangle = { x: 0, y: 0, width: 1280, height: 800 };
  const view = {
    webContents: new Contents(9951),
    setVisible: vi.fn(),
    setBounds: vi.fn((next: Electron.Rectangle) => {
      bounds = next;
    }),
    getBounds: () => bounds,
  };
  const createView = vi.fn(() => view as unknown as WebContentsView);
  const prepare = vi.fn();
  let clipBounds: Electron.Rectangle = { x: 0, y: 0, width: 1280, height: 800 };
  const clip = {
    setBounds: vi.fn((next: Electron.Rectangle) => {
      clipBounds = next;
    }),
    getBounds: () => clipBounds,
    addChildView: vi.fn(),
    removeChildView: vi.fn(),
  };
  const owner = new NativeBrowserViewOwner({
    profile: () => profile,
    preloadPath: () => "/owned/keyboard-preload.js",
    createView,
    prepare,
    createClipView: () => clip as unknown as View,
  });
  owner.registerHost(host as unknown as BrowserWindow);
  const input = {
    browserId: "retained-native",
    workspaceId: "native-workspace",
    url: "https://example.com/",
  };
  return { owner, host, view, clip, createView, prepare, input };
}

describe("native view creator and retained presentation", () => {
  test.each([
    { hostZoom: 1.25, pageZoom: 1, mode: "fixed" as const, width: 672, height: 1497 },
    { hostZoom: 1, pageZoom: 1.25, mode: "fixed" as const, width: 840, height: 1871 },
    { hostZoom: 1.25, pageZoom: 1.5, mode: "responsive" as const, width: 840, height: 1871 },
  ])(
    "$mode viewport separates host $hostZoom from page $pageZoom zoom",
    ({ hostZoom, pageZoom, mode, width, height }) => {
      const { owner, host, view, clip, input } = nativeOwnerFixture();
      host.webContents.zoomFactor = hostZoom;
      view.webContents.zoomFactor = pageZoom;
      const identity = owner.create(host.webContents.id, input);
      owner.present(host.webContents.id, {
        browserId: input.browserId,
        viewportMode: mode,
        visible: true,
        bounds: { x: -80, y: -100, width: 672, height: 1497 },
        clip: { x: 200, y: 100, width: 400, height: 320 },
      });
      expect(clip.setBounds).toHaveBeenLastCalledWith({
        x: Math.round(200 * hostZoom),
        y: Math.round(100 * hostZoom),
        width: Math.round(400 * hostZoom),
        height: Math.round(320 * hostZoom),
      });
      expect(view.setBounds).toHaveBeenLastCalledWith({
        x: Math.round(-280 * hostZoom),
        y: Math.round(-200 * hostZoom),
        width,
        height,
      });
      const hidden = owner.present(host.webContents.id, {
        browserId: input.browserId,
        viewportMode: mode,
        visible: false,
        bounds: { x: -80, y: -100, width: 672, height: 1497 },
      });
      expect(view.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width, height });
      expect(clip.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width, height });
      expect(hidden.webContentsId).toBe(identity.webContentsId);
      expect(hidden.presentationScale).toBe(pageZoom / hostZoom);
      expect(view.webContents.zoomFactor).toBe(pageZoom);
      expect(host.webContents.zoomFactor).toBe(hostZoom);
      expect(view.webContents.focus).not.toHaveBeenCalled();
      owner.close(host.webContents.id, input.browserId);
    },
  );

  test("fractional clip edges convert before rounding inward, including a negative origin", () => {
    const { owner, host, view, clip, input } = nativeOwnerFixture();
    host.webContents.zoomFactor = 1.25;
    owner.create(host.webContents.id, input);
    owner.present(host.webContents.id, {
      browserId: input.browserId,
      viewportMode: "fixed",
      visible: true,
      bounds: { x: -68.8, y: -438.8, width: 672, height: 1497 },
      clip: { x: 10.2, y: 20.2, width: 400.4, height: 320.4 },
    });
    expect(clip.setBounds).toHaveBeenLastCalledWith({ x: 13, y: 26, width: 500, height: 399 });
    expect(view.setBounds).toHaveBeenLastCalledWith({ x: -99, y: -574, width: 672, height: 1497 });
    owner.close(host.webContents.id, input.browserId);
  });

  test("presentation IPC requires an explicit dimension space", () => {
    const request = {
      browserId: "page",
      webContentsId: 9951,
      visible: true,
      bounds: { x: 0, y: 0, width: 672, height: 1497 },
    };
    expect(BrowserViewPresentationSchema.safeParse(request).success).toBe(false);
    expect(
      BrowserViewPresentationSchema.safeParse({ ...request, viewportMode: "fixed" }).success,
    ).toBe(true);
    expect(
      BrowserViewPresentationSchema.safeParse({ ...request, viewportMode: "responsive" }).success,
    ).toBe(true);
    expect(
      BrowserViewPresentationSchema.safeParse({ ...request, viewportMode: "automatic" }).success,
    ).toBe(false);
  });

  test("hidden resize parks the full native viewport before restoring exact pane clipping", () => {
    const { owner, host, view, clip, createView, input } = nativeOwnerFixture();
    const original = owner.create(host.webContents.id, input);
    const pane = {
      viewportMode: "fixed" as const,
      browserId: input.browserId,
      visible: true,
      bounds: { x: -200, y: 120, width: 1920, height: 1080 },
      clip: { x: 320, y: 120, width: 880, height: 680 },
    };
    owner.present(host.webContents.id, pane);
    expect(view.setBounds).toHaveBeenLastCalledWith({ x: -520, y: 0, width: 1920, height: 1080 });
    view.setVisible.mockClear();
    view.setBounds.mockClear();
    clip.setBounds.mockClear();

    const hidden = owner.present(host.webContents.id, {
      ...pane,
      visible: false,
      bounds: { ...pane.bounds, width: 412, height: 915 },
    });
    expect(view.setVisible.mock.calls[0]).toEqual([false]);
    expect(view.setVisible.mock.invocationCallOrder[0]).toBeLessThan(
      clip.setBounds.mock.invocationCallOrder[0],
    );
    expect(view.setVisible.mock.invocationCallOrder[0]).toBeLessThan(
      view.setBounds.mock.invocationCallOrder[0],
    );
    expect(clip.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 412, height: 915 });
    expect(view.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 412, height: 915 });
    expect(hidden.visible).toBe(false);
    expect(hidden.webContentsId).toBe(original.webContentsId);
    expect(owner.focus(host.webContents.id, input.browserId)).toBe(false);

    owner.present(host.webContents.id, pane);
    expect(clip.setBounds).toHaveBeenLastCalledWith(pane.clip);
    expect(view.setBounds).toHaveBeenLastCalledWith({ x: -520, y: 0, width: 1920, height: 1080 });
    expect(view.setVisible).toHaveBeenLastCalledWith(true);
    expect(createView).toHaveBeenCalledTimes(1);
    expect(view.webContents.session).toBe(host.webContents.session);
    expect(view.webContents.focus).not.toHaveBeenCalled();
    owner.close(host.webContents.id, input.browserId);
  });

  test("native parent clips fixed device presentation while contents retain the full viewport", () => {
    const { owner, host, view, clip, input } = nativeOwnerFixture();
    owner.create(host.webContents.id, input);
    owner.present(host.webContents.id, {
      viewportMode: "fixed",
      browserId: input.browserId,
      visible: true,
      bounds: { x: -400, y: -500, width: 1920, height: 1080 },
      clip: { x: 200, y: 100, width: 600, height: 480 },
    });
    expect(view.setBounds).toHaveBeenLastCalledWith({
      x: -600,
      y: -600,
      width: 1920,
      height: 1080,
    });
    expect(clip.setBounds).toHaveBeenLastCalledWith({ x: 200, y: 100, width: 600, height: 480 });
    expect(clip.addChildView).toHaveBeenCalledWith(view);
    expect(clip.setBounds.mock.invocationCallOrder[0]).toBeLessThan(
      host.contentView.addChildView.mock.invocationCallOrder[1],
    );
    expect(host.contentView.addChildView.mock.invocationCallOrder[1]).toBeLessThan(
      clip.addChildView.mock.invocationCallOrder[0],
    );
    expect(host.contentView.removeChildView).not.toHaveBeenCalled();
    expect(owner.snapshot(host.webContents.id, input.browserId).webContentsId).toBe(
      view.webContents.id,
    );
    expect(view.webContents.isDestroyed()).toBe(false);
    owner.close(host.webContents.id, input.browserId);
    expect(clip.removeChildView).toHaveBeenCalledWith(view);
    expect(host.contentView.removeChildView).toHaveBeenCalledWith(clip);
    expect(view.webContents.isDestroyed()).toBe(true);
  });
  test("IPC identities reject arbitrary host IDs and invalid contents IDs", () => {
    expect(
      CreateBrowserViewSchema.safeParse({
        browserId: "page",
        workspaceId: "workspace",
        url: "about:blank",
        hostId: 9950,
      }).success,
    ).toBe(false);
    for (const webContentsId of [0, -1, 1.5, "9951"]) {
      expect(
        BrowserViewIdentitySchema.safeParse({ browserId: "page", webContentsId }).success,
      ).toBe(false);
    }
  });

  test("a crashed host renderer hides surfaces without destroying retained documents", () => {
    const { owner, host, view, input } = nativeOwnerFixture();
    owner.create(host.webContents.id, input);
    owner.present(host.webContents.id, {
      viewportMode: "fixed",
      browserId: input.browserId,
      visible: true,
      bounds: { x: 0, y: 0, width: 672, height: 1497 },
    });
    host.webContents.emit("render-process-gone", {}, { reason: "crashed" });
    expect(owner.snapshot(host.webContents.id, input.browserId).visible).toBe(false);
    expect(view.webContents.isDestroyed()).toBe(false);
    expect(owner.focus(host.webContents.id, input.browserId)).toBe(false);
    owner.close(host.webContents.id, input.browserId);
  });
  test("creates one trusted native page across UI navigation and hide/show", () => {
    const { owner, host, view, createView, input } = nativeOwnerFixture();
    const first = owner.create(host.webContents.id, input);
    owner.present(host.webContents.id, {
      viewportMode: "fixed",
      browserId: input.browserId,
      visible: true,
      bounds: { x: 10, y: 40, width: 672, height: 1497 },
    });
    host.webContents.emit("did-start-navigation", {}, "paseo://ui", false, true);
    const retained = owner.create(host.webContents.id, input);
    expect(retained.webContentsId).toBe(first.webContentsId);
    expect(retained.visible).toBe(false);
    expect(createView).toHaveBeenCalledTimes(1);
    expect(view.webContents.isDestroyed()).toBe(false);
    owner.close(host.webContents.id, input.browserId);
  });

  test("foreground focus requires explicit presentation without activating a host", () => {
    const { owner, host, view, input } = nativeOwnerFixture();
    owner.create(host.webContents.id, input);
    expect(owner.focus(host.webContents.id, input.browserId)).toBe(false);
    owner.present(host.webContents.id, {
      viewportMode: "fixed",
      browserId: input.browserId,
      visible: true,
      bounds: { x: 10, y: 40, width: 672, height: 1497 },
    });
    expect(owner.focus(host.webContents.id, input.browserId)).toBe(false);
    expect(view.webContents.focus).not.toHaveBeenCalled();
    host.focused = true;
    expect(owner.focus(host.webContents.id, input.browserId)).toBe(true);
    expect(view.webContents.focus).toHaveBeenCalledTimes(1);
    owner.close(host.webContents.id, input.browserId);
  });

  test("foreign host control is rejected without navigating or closing the owned page", () => {
    const { owner, host, view, input } = nativeOwnerFixture();
    owner.create(host.webContents.id, input);
    expect(() => owner.control(9959, input.browserId, "reload")).toThrow(
      "unavailable to this host",
    );
    expect(() => owner.close(9959, input.browserId)).toThrow("unavailable to this host");
    expect(view.webContents.reload).not.toHaveBeenCalled();
    expect(view.webContents.isDestroyed()).toBe(false);
    owner.close(host.webContents.id, input.browserId);
  });

  test("an old contents identity cannot mutate a retained browser", () => {
    const { owner, host, view, input } = nativeOwnerFixture();
    owner.create(host.webContents.id, input);
    expect(() => owner.assertTarget(host.webContents.id, input.browserId, 99999)).toThrow(
      "target was replaced",
    );
    expect(view.webContents.isDestroyed()).toBe(false);
    expect(view.webContents.focus).not.toHaveBeenCalled();
    owner.close(host.webContents.id, input.browserId);
  });

  test("closed hosts retire native contents and registry access", () => {
    const { owner, host, view, input } = nativeOwnerFixture();
    owner.create(host.webContents.id, input);
    host.destroyed = true;
    host.emit("closed");
    expect(view.webContents.isDestroyed()).toBe(true);
    expect(isPreparedPaseoBrowserWebContents(view.webContents)).toBe(false);
    expect(owner.owns(host.webContents.id, input.browserId)).toBe(false);
    expect(getPaseoBrowserIdForWebContents(view.webContents)).toBeNull();
  });
});

/** Overlay regressions use the existing native owner fixture, not a second lifecycle. */
describe("native menu overlap ownership", () => {
  const firstToken = "11111111-1111-4111-8111-111111111111";
  const nestedToken = "22222222-2222-4222-8222-222222222222";
  const scope = { x: 0, y: 0, width: 1000, height: 800 };

  function admitOverlay(owner: NativeBrowserViewOwner, hostId: number, token: string) {
    const targets = owner.prepareOverlay(hostId, token);
    owner.commitOverlay(hostId, token, []);
    return targets;
  }

  function presentedFixture() {
    const fixture = nativeOwnerFixture();
    const { owner, host, input } = fixture;
    const identity = owner.create(host.webContents.id, input);
    owner.present(host.webContents.id, {
      browserId: input.browserId,
      viewportMode: "fixed",
      visible: true,
      bounds: { x: -100, y: -200, width: 1920, height: 1080 },
      clip: { x: 100, y: 150, width: 600, height: 480 },
    });
    return { ...fixture, identity };
  }

  test("preparation leaves the native page live until matching frame commit", () => {
    const { owner, host, view, input } = presentedFixture();
    const targets = owner.prepareOverlay(host.webContents.id, firstToken);
    expect(view.setVisible).toHaveBeenLastCalledWith(true);
    expect(owner.snapshot(host.webContents.id, input.browserId).visible).toBe(true);
    expect(owner.commitOverlay(host.webContents.id, firstToken, targets)).toBe(true);
    expect(view.setVisible).toHaveBeenLastCalledWith(false);
    owner.endOverlay(host.webContents.id, firstToken);
    expect(view.setVisible).toHaveBeenLastCalledWith(true);
    host.emit("closed");
  });

  test("stale geometry refuses image commit before hiding and permits explicit blank", () => {
    const { owner, host, view, input } = presentedFixture();
    const targets = owner.prepareOverlay(host.webContents.id, firstToken);
    owner.present(host.webContents.id, {
      browserId: input.browserId,
      viewportMode: "fixed",
      visible: true,
      bounds: { x: 0, y: 0, width: 412, height: 915 },
      clip: scope,
    });
    expect(owner.commitOverlay(host.webContents.id, firstToken, targets)).toBe(false);
    expect(view.setVisible).toHaveBeenLastCalledWith(true);
    expect(owner.commitOverlay(host.webContents.id, firstToken, [])).toBe(true);
    expect(view.setVisible).toHaveBeenLastCalledWith(false);
    host.emit("closed");
  });

  test("host-only zoom changes reject staged geometry without a page revision change", () => {
    const { owner, host, view } = presentedFixture();
    const targets = owner.prepareOverlay(host.webContents.id, firstToken);
    host.webContents.zoomFactor = 1.25;
    expect(owner.prepareOverlay(host.webContents.id, nestedToken)).toEqual(targets);
    expect(owner.commitOverlay(host.webContents.id, firstToken, targets)).toBe(false);
    expect(view.setVisible).toHaveBeenLastCalledWith(true);
    expect(owner.commitOverlay(host.webContents.id, firstToken, [])).toBe(true);
    host.emit("closed");
  });

  test("released preparations and forged frame identities cannot recreate suppression", () => {
    const { owner, host, view } = presentedFixture();
    const targets = owner.prepareOverlay(host.webContents.id, firstToken);
    expect(
      owner.commitOverlay(
        host.webContents.id,
        firstToken,
        targets.map((target) => ({ ...target, webContentsId: target.webContentsId + 1 })),
      ),
    ).toBe(false);
    expect(view.setVisible).toHaveBeenLastCalledWith(true);
    owner.endOverlay(host.webContents.id, firstToken);
    expect(owner.commitOverlay(host.webContents.id, firstToken, targets)).toBe(false);
    expect(owner.commitOverlay(host.webContents.id, firstToken, [])).toBe(false);
    host.emit("closed");
  });

  test("nested registrations hide before acknowledgement and restore exact same geometry only after the last release", () => {
    const { owner, host, view, clip, input, identity } = presentedFixture();
    host.focused = true;
    const bounds = view.getBounds();
    const clipBounds = clip.getBounds();
    const targets = admitOverlay(owner, host.webContents.id, firstToken);
    expect(targets).toEqual([
      expect.objectContaining({
        browserId: input.browserId,
        webContentsId: identity.webContentsId,
      }),
    ]);
    expect(view.setVisible).toHaveBeenLastCalledWith(false);
    expect(owner.snapshot(host.webContents.id, input.browserId).visible).toBe(false);
    expect(owner.focus(host.webContents.id, input.browserId)).toBe(false);
    expect(admitOverlay(owner, host.webContents.id, nestedToken)).toEqual(targets);
    owner.endOverlay(host.webContents.id, firstToken);
    expect(view.setVisible).toHaveBeenLastCalledWith(false);
    owner.endOverlay(host.webContents.id, nestedToken);
    expect(view.setVisible).toHaveBeenLastCalledWith(true);
    expect(view.getBounds()).toEqual(bounds);
    expect(clip.getBounds()).toEqual(clipBounds);
    expect(view.webContents.id).toBe(identity.webContentsId);
    expect(view.webContents.focus).not.toHaveBeenCalled();
    owner.close(host.webContents.id, input.browserId);
  });

  test("visible resize and scroll updates stay suppressed until the last overlay releases", () => {
    const { owner, host, view, clip, input, identity } = presentedFixture();
    admitOverlay(owner, host.webContents.id, firstToken);
    admitOverlay(owner, host.webContents.id, nestedToken);
    for (const bounds of [
      { x: -250, y: -100, width: 1920, height: 1080 },
      { x: -300, y: -180, width: 1920, height: 1080 },
    ]) {
      owner.present(host.webContents.id, {
        browserId: input.browserId,
        visible: true,
        viewportMode: "fixed",
        bounds,
        clip: { x: 40, y: 80, width: 640, height: 360 },
      });
      expect(view.setVisible).toHaveBeenLastCalledWith(false);
      expect(owner.snapshot(host.webContents.id, input.browserId).visible).toBe(false);
    }
    const latestBounds = view.getBounds();
    const latestClip = clip.getBounds();
    owner.endOverlay(host.webContents.id, firstToken);
    expect(view.setVisible).toHaveBeenLastCalledWith(false);
    owner.endOverlay(host.webContents.id, nestedToken);
    expect(view.setVisible).toHaveBeenLastCalledWith(true);
    expect(view.getBounds()).toEqual(latestBounds);
    expect(clip.getBounds()).toEqual(latestClip);
    expect(view.webContents.id).toBe(identity.webContentsId);
    expect(view.webContents.focus).not.toHaveBeenCalled();
    owner.close(host.webContents.id, input.browserId);
  });

  test("a page first presented during an open menu remains hidden until release", () => {
    const { owner, host, view, input } = nativeOwnerFixture();
    const identity = owner.create(host.webContents.id, input);
    expect(admitOverlay(owner, host.webContents.id, firstToken)).toEqual([]);
    owner.present(host.webContents.id, {
      browserId: input.browserId,
      visible: true,
      viewportMode: "fixed",
      bounds: scope,
    });
    expect(view.setVisible).toHaveBeenLastCalledWith(false);
    expect(owner.snapshot(host.webContents.id, input.browserId).visible).toBe(false);
    owner.endOverlay(host.webContents.id, firstToken);
    expect(view.setVisible).toHaveBeenLastCalledWith(true);
    expect(view.webContents.id).toBe(identity.webContentsId);
    expect(view.webContents.focus).not.toHaveBeenCalled();
    owner.close(host.webContents.id, input.browserId);
  });

  test("capture crops the actual visible native region and attempts no second frame for a token", async () => {
    const { owner, host, view, input } = presentedFixture();
    const capture = vi.fn(async () => ({
      getSize: () => ({ width: 600, height: 480 }),
      toPNG: () => new Uint8Array([1, 2, 3]),
    }));
    const retire = registerNativeBrowserSurface(view.webContents.id, { capture });
    try {
      const [target] = admitOverlay(owner, host.webContents.id, firstToken);
      const frame = await owner.captureOverlay(host.webContents.id, firstToken, target!);
      expect(capture).toHaveBeenCalledWith(expect.any(AbortSignal), {
        x: 200,
        y: 350,
        width: 600,
        height: 480,
      });
      expect(frame).toEqual({
        ...target,
        bounds: { x: 100, y: 150, width: 600, height: 480 },
        dataUrl: "data:image/png;base64,AQID",
      });
      expect(await owner.captureOverlay(host.webContents.id, firstToken, target!)).toBeNull();
      owner.endOverlay(host.webContents.id, firstToken);
    } finally {
      retire();
      owner.close(host.webContents.id, input.browserId);
    }
  });

  test("capture failure yields blank while suppression remains owned by the open menu", async () => {
    const { owner, host, view, input } = presentedFixture();
    const retire = registerNativeBrowserSurface(view.webContents.id, {
      capture: async () => {
        throw new Error("no current frame");
      },
    });
    try {
      const [target] = admitOverlay(owner, host.webContents.id, firstToken);
      expect(await owner.captureOverlay(host.webContents.id, firstToken, target!)).toBeNull();
      expect(view.setVisible).toHaveBeenLastCalledWith(false);
      owner.endOverlay(host.webContents.id, firstToken);
      expect(view.setVisible).toHaveBeenLastCalledWith(true);
    } finally {
      retire();
      owner.close(host.webContents.id, input.browserId);
    }
  });

  test("navigation invalidates an unsettled frame and closing the page prevents late resurrection", async () => {
    const { owner, host, view, input } = presentedFixture();
    let finish!: (image: {
      getSize(): { width: number; height: number };
      toPNG(): Uint8Array;
    }) => void;
    const retire = registerNativeBrowserSurface(view.webContents.id, {
      capture: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    try {
      const [target] = admitOverlay(owner, host.webContents.id, firstToken);
      const pending = owner.captureOverlay(host.webContents.id, firstToken, target!);
      view.webContents.emit("did-start-navigation", {}, "https://example.com/account", false, true);
      owner.close(host.webContents.id, input.browserId);
      view.setVisible.mockClear();
      owner.endOverlay(host.webContents.id, firstToken);
      finish({ getSize: () => ({ width: 600, height: 480 }), toPNG: () => new Uint8Array([1]) });
      expect(await pending).toBeNull();
      expect(view.setVisible).not.toHaveBeenCalled();
    } finally {
      retire();
    }
  });

  test("inactive pages stay hidden, foreign hosts cannot acquire tokens, and UI failure cannot restore presentation", () => {
    const { owner, host, view, input } = nativeOwnerFixture();
    owner.create(host.webContents.id, input);
    expect(() => admitOverlay(owner, 1234567, firstToken)).toThrow("not an application host");
    expect(admitOverlay(owner, host.webContents.id, firstToken)).toEqual([]);
    owner.endOverlay(host.webContents.id, firstToken);
    expect(view.setVisible).toHaveBeenLastCalledWith(false);
    owner.present(host.webContents.id, {
      browserId: input.browserId,
      visible: true,
      viewportMode: "fixed",
      bounds: scope,
    });
    admitOverlay(owner, host.webContents.id, firstToken);
    host.webContents.emit("render-process-gone");
    owner.endOverlay(host.webContents.id, firstToken);
    expect(view.setVisible).toHaveBeenLastCalledWith(false);
    owner.close(host.webContents.id, input.browserId);
  });
  test("a timed-out frame is blank and a late native result cannot regain token ownership", async () => {
    vi.useFakeTimers();
    const { owner, host, view, input } = presentedFixture();
    let finish!: (image: {
      getSize(): { width: number; height: number };
      toPNG(): Uint8Array;
    }) => void;
    let signal!: AbortSignal;
    const retire = registerNativeBrowserSurface(view.webContents.id, {
      capture: (received) => {
        signal = received;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    });
    try {
      const [target] = admitOverlay(owner, host.webContents.id, firstToken);
      const pending = owner.captureOverlay(host.webContents.id, firstToken, target!);
      await vi.advanceTimersByTimeAsync(251);
      expect(await pending).toBeNull();
      expect(signal.aborted).toBe(true);
      expect(view.setVisible).toHaveBeenLastCalledWith(false);
      owner.endOverlay(host.webContents.id, firstToken);
      finish({ getSize: () => ({ width: 600, height: 480 }), toPNG: () => new Uint8Array([1]) });
      await Promise.resolve();
      expect(view.setVisible).toHaveBeenLastCalledWith(true);
    } finally {
      retire();
      owner.close(host.webContents.id, input.browserId);
      vi.useRealTimers();
    }
  });

  test("hidden workspace updates do not revive on release", () => {
    const { owner, host, view, input } = presentedFixture();
    admitOverlay(owner, host.webContents.id, firstToken);
    owner.present(host.webContents.id, {
      browserId: input.browserId,
      visible: false,
      viewportMode: "fixed",
      bounds: { x: -100, y: -200, width: 412, height: 915 },
      clip: { x: 100, y: 150, width: 600, height: 480 },
    });
    owner.endOverlay(host.webContents.id, firstToken);
    expect(view.setVisible).toHaveBeenLastCalledWith(false);
    expect(view.getBounds()).toEqual({ x: 0, y: 0, width: 412, height: 915 });
    owner.close(host.webContents.id, input.browserId);
  });
  test("overlay crops convert native DIP to host CSS without modifying independent page zoom", async () => {
    const { owner, host, view, input } = presentedFixture();
    host.webContents.zoomFactor = 1.25;
    owner.present(host.webContents.id, {
      browserId: input.browserId,
      visible: true,
      viewportMode: "fixed",
      bounds: { x: -100, y: -200, width: 1920, height: 1080 },
      clip: { x: 100, y: 150, width: 600, height: 480 },
    });
    const capture = vi.fn(async () => ({
      getSize: () => ({ width: 750, height: 599 }),
      toPNG: () => new Uint8Array([1]),
    }));
    const retire = registerNativeBrowserSurface(view.webContents.id, { capture });
    try {
      const [target] = admitOverlay(owner, host.webContents.id, firstToken);
      const frame = await owner.captureOverlay(host.webContents.id, firstToken, target!);
      expect(frame?.bounds).toEqual({ x: 100, y: 150.4, width: 600, height: 479.2 });
      expect(capture).toHaveBeenCalledWith(expect.any(AbortSignal), {
        x: 250,
        y: 438,
        width: 750,
        height: 599,
      });
      expect(view.webContents.zoomFactor).toBe(1);
      expect(host.webContents.zoomFactor).toBe(1.25);
      owner.endOverlay(host.webContents.id, firstToken);
      expect(view.getBounds()).toEqual({ x: -250, y: -438, width: 1920, height: 1080 });
    } finally {
      retire();
      owner.close(host.webContents.id, input.browserId);
    }
  });

  test("foreign host/target commands cannot capture or release a menu's native ownership", () => {
    const { owner, host, view, input } = presentedFixture();
    const [target] = admitOverlay(owner, host.webContents.id, firstToken);
    expect(() => owner.captureOverlay(1234567, firstToken, target!)).toThrow(
      "not an application host",
    );
    expect(() =>
      owner.captureOverlay(host.webContents.id, firstToken, { ...target!, webContentsId: 1234567 }),
    ).toThrow("target was replaced");
    expect(() => owner.endOverlay(1234567, firstToken)).toThrow("not an application host");
    expect(view.setVisible).toHaveBeenLastCalledWith(false);
    owner.endOverlay(host.webContents.id, firstToken);
    owner.close(host.webContents.id, input.browserId);
  });
});
