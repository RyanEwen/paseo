import { describe, expect, it, vi } from "vitest";
import type { DesktopNativeBrowserState } from "@/desktop/host";
import { createNativeBrowserPage } from "../native-page.electron";
import { resolveNativeBrowserGeometry } from "../resident-native-pages.electron";
import type { NativeBrowserSession } from "../native-session.electron";
import {
  createElementSelectorController,
  type BrowserElementSelection,
  type ElementSelectorOutcome,
  type ElementSelectorRuntime,
  type ElementSelectorWebview,
} from "./element-selector.electron";

describe("native pane viewport and retained page commands", () => {
  it("clips an oversized centered device without reducing its CSS viewport", () => {
    const geometry = resolveNativeBrowserGeometry(
      { x: -400.5, y: -500.5, width: 1920, height: 1080 },
      { x: 200.25, y: 100.25, width: 600, height: 500 },
      { mode: "fixed", width: 1920, height: 1080 },
    );
    expect(geometry.bounds).toEqual({ x: -400.5, y: -500.5, width: 1920, height: 1080 });
    expect(geometry.clip).toEqual({ x: 200.25, y: 100.25, width: 600, height: 479.25 });
    expect(geometry.visible).toBe(true);
  });

  it("fixed page CSS extents do not enlarge the host CSS frame intersection", () => {
    // Page zoom 1 / host zoom 1.25 produces a 537.6 by 1197.6 host CSS frame.
    const geometry = resolveNativeBrowserGeometry(
      { x: -68.8, y: -438.8, width: 537.6, height: 1197.6 },
      { x: 0, y: 0, width: 400, height: 320 },
      { mode: "fixed", width: 672, height: 1497 },
    );
    expect(geometry.bounds).toEqual({ x: -68.8, y: -438.8, width: 672, height: 1497 });
    expect(geometry.clip).toEqual({ x: 0, y: 0, width: 400, height: 320 });
    expect(geometry.visible).toBe(true);
    const responsive = resolveNativeBrowserGeometry(
      { x: 10, y: 20, width: 400, height: 320 },
      { x: 10, y: 20, width: 400, height: 320 },
      { mode: "responsive" },
    );
    expect(responsive.bounds).toEqual({ x: 10, y: 20, width: 400, height: 320 });
    expect(responsive.clip).toEqual(responsive.bounds);
  });

  it("late main zoom observations update the frame ratio but cannot revive a closed page", async () => {
    let receive!: (state: DesktopNativeBrowserState) => void;
    const close = vi.fn(async () => {});
    const page = createNativeBrowserPage(
      { browserId: "zoom-page", workspaceId: "workspace", url: "https://example.com" },
      async (input) => {
        receive = input.onState;
        return { close } as unknown as NativeBrowserSession;
      },
    );
    const changed = vi.fn();
    page.addEventListener("presentation-changed", changed);
    const state: DesktopNativeBrowserState = {
      browserId: "zoom-page",
      workspaceId: "workspace",
      webContentsId: 123,
      url: "https://example.com",
      title: "Fixture",
      faviconUrl: null,
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      visible: true,
      focused: false,
      lastError: null,
      presentationScale: 0.8,
    };
    receive(state);
    expect(page.getPresentationScale()).toBe(0.8);
    expect(changed).toHaveBeenCalledTimes(1);
    await page.close();
    receive({ ...state, presentationScale: 1.25 });
    expect(page.getPresentationScale()).toBe(0.8);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("a late mount presentation cannot override a newer hide request", async () => {
    let resolveSession!: (session: NativeBrowserSession) => void;
    const pending = new Promise<NativeBrowserSession>((resolve) => {
      resolveSession = resolve;
    });
    const present = vi.fn(async () => {});
    const page = createNativeBrowserPage(
      { browserId: "native", workspaceId: "workspace", url: "https://example.com" },
      () => pending,
    );
    const bounds = { x: 10, y: 30, width: 672, height: 1497 };
    const mounted = page.present(bounds, true, undefined, "fixed");
    const hidden = page.present(bounds, false, undefined, "fixed");
    resolveSession({ present } as unknown as NativeBrowserSession);
    await Promise.all([mounted, hidden]);
    expect(present).toHaveBeenCalledTimes(1);
    expect(present).toHaveBeenCalledWith(bounds, false, undefined, "fixed");
  });

  it("closing during creation prevents queued presentation from showing a retired tab", async () => {
    let resolveSession!: (session: NativeBrowserSession) => void;
    const pending = new Promise<NativeBrowserSession>((resolve) => {
      resolveSession = resolve;
    });
    const present = vi.fn(async () => {});
    const close = vi.fn(async () => {});
    const page = createNativeBrowserPage(
      { browserId: "closing", workspaceId: "workspace", url: "https://example.com" },
      () => pending,
    );
    const showing = page.present({ x: 0, y: 0, width: 800, height: 600 }, true, undefined, "fixed");
    const closing = page.close();
    resolveSession({ present, close } as unknown as NativeBrowserSession);
    await Promise.all([showing, closing]);
    expect(present).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
    expect(page.isConnected).toBe(false);
  });
});

function selectorHarness() {
  let installed: ((state: "installed" | "loading" | "unavailable") => void) | undefined;
  let result: ((selection: BrowserElementSelection | null) => void) | undefined;
  let timeout: (() => void) | undefined;
  const cleared: string[] = [];
  const destroyed: string[] = [];
  const stopped: string[] = [];
  const cancelledTimeouts: number[] = [];
  const runtime: ElementSelectorRuntime = {
    token: () => "session-1",
    install: () =>
      new Promise((resolve) => {
        installed = resolve;
      }),
    watch: (_webview, token, onResult) => {
      result = onResult;
      return () => stopped.push(token);
    },
    clear: (_webview, token) => cleared.push(token),
    destroy: (_webview, token) => destroyed.push(token),
    timeout: (callback) => {
      timeout = callback;
      return 7;
    },
    cancelTimeout: (id) => cancelledTimeouts.push(id),
  };
  const webview = { isConnected: true, isLoading: () => false } as ElementSelectorWebview;
  return {
    runtime,
    webview,
    cleared,
    destroyed,
    stopped,
    cancelledTimeouts,
    install: (state: "installed" | "loading" | "unavailable") => installed?.(state),
    select: (selection: BrowserElementSelection | null) => result?.(selection),
    expire: () => timeout?.(),
  };
}

async function settleInstallation(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("element selector owner", () => {
  it("owns installation through selected completion", async () => {
    const harness = selectorHarness();
    const outcomes: ElementSelectorOutcome[] = [];
    const controller = createElementSelectorController(harness.runtime);

    expect(
      controller.start({
        webview: harness.webview,
        mode: "annotate",
        onFinish: (outcome) => outcomes.push(outcome),
      }),
    ).toBe("started");
    harness.install("installed");
    await settleInstallation();
    const selection: BrowserElementSelection = {
      url: "https://example.test/form",
      selector: "#submit",
      tag: "button",
      text: "Submit",
      outerHTML: '<button id="submit">Submit</button>',
      computedStyles: {},
      boundingRect: { x: 10, y: 20, width: 80, height: 30 },
      reactSource: null,
      parentChain: ["form"],
      children: [],
    };
    harness.select(selection);

    expect(outcomes).toEqual([
      {
        type: "selected",
        mode: "annotate",
        selection,
      },
    ]);
    expect(harness.stopped).toEqual(["session-1"]);
    expect(harness.cancelledTimeouts).toEqual([7]);
  });

  it("cleans up a cancelled session even when guest installation finishes late", async () => {
    const harness = selectorHarness();
    const outcomes: ElementSelectorOutcome[] = [];
    const controller = createElementSelectorController(harness.runtime);

    controller.start({
      webview: harness.webview,
      mode: "screenshot",
      onFinish: (outcome) => outcomes.push(outcome),
    });
    controller.cancel();
    harness.install("installed");
    await settleInstallation();

    expect(outcomes).toEqual([{ type: "cancelled" }]);
    expect(harness.cleared).toEqual(["session-1"]);
    expect(harness.destroyed).toEqual(["session-1"]);
  });

  it("destroys the guest session when selection times out", () => {
    const harness = selectorHarness();
    const outcomes: ElementSelectorOutcome[] = [];
    const controller = createElementSelectorController(harness.runtime);

    controller.start({
      webview: harness.webview,
      mode: "annotate",
      onFinish: (outcome) => outcomes.push(outcome),
    });
    harness.expire();

    expect(outcomes).toEqual([{ type: "failed", reason: "timeout" }]);
    expect(harness.destroyed).toEqual(["session-1"]);
  });
});
