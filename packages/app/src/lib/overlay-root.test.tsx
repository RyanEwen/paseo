// @vitest-environment jsdom
import React, { useEffect, useRef } from "react";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWebOverlayPresentationLifetime } from "./overlay-presentation-lifetime";
import { installWebOverlayPresentationGuard } from "./overlay-presentation";
import { dispatchTopWebOverlayKeyDown, useWebOverlayRegistration } from "./overlay-root";

describe("useWebOverlayRegistration", () => {
  let opener: HTMLButtonElement;
  let input: HTMLInputElement;
  let scope: HTMLDivElement;

  beforeEach(() => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 0;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

    opener = document.createElement("button");
    input = document.createElement("input");
    scope = document.createElement("div");
    scope.tabIndex = -1;
    scope.inert = false;
    scope.append(input);
    document.body.append(opener, scope);
    opener.focus();
    expect(document.activeElement).toBe(opener);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("does not restore opener focus when an active overlay scope detaches", () => {
    const { result, unmount } = renderHook(() =>
      useWebOverlayRegistration({ active: true, layer: 20, onKeyDown: () => false }),
    );

    act(() => result.current(scope));
    const openerFocus = vi.spyOn(opener, "focus");
    input.focus();
    expect(document.activeElement).toBe(input);

    act(() => result.current(null));

    expect(openerFocus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
    unmount();
  });

  it("restores opener focus when an overlay closes", () => {
    const { result, rerender, unmount } = renderHook(
      ({ active }: { active: boolean }) =>
        useWebOverlayRegistration({ active, layer: 20, onKeyDown: () => false }),
      { initialProps: { active: true } },
    );

    act(() => result.current(scope));
    const openerFocus = vi.spyOn(opener, "focus");
    input.focus();
    expect(document.activeElement).toBe(input);

    act(() => rerender({ active: false }));

    expect(openerFocus).toHaveBeenCalled();
    unmount();
  });

  it("restores opener focus when an active overlay unmounts after its scope detaches", () => {
    const { result, unmount } = renderHook(() =>
      useWebOverlayRegistration({ active: true, layer: 20, onKeyDown: () => false }),
    );

    act(() => result.current(scope));
    const openerFocus = vi.spyOn(opener, "focus");
    input.focus();
    expect(document.activeElement).toBe(input);

    act(() => result.current(null));
    expect(openerFocus).not.toHaveBeenCalled();

    unmount();

    expect(openerFocus).toHaveBeenCalled();
  });

  it("leaves IME composition keys with the focused editor", () => {
    const event = new KeyboardEvent("keydown", { key: "Process", bubbles: true });
    expect(dispatchTopWebOverlayKeyDown(event)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });
  it("holds menu paint, interaction and focus until native admission while preserving measurement", async () => {
    let admit!: (ready: boolean) => void;
    const release = vi.fn();
    const guard = vi.fn(() => ({
      ready: new Promise<boolean>((resolve) => {
        admit = resolve;
      }),
      release,
    }));
    const uninstall = installWebOverlayPresentationGuard(guard);
    const onPresentationReady = vi.fn();
    const { result, rerender, unmount } = renderHook(
      ({ layer }: { layer: number }) =>
        useWebOverlayRegistration({
          active: true,
          layer,
          onKeyDown: () => false,
          nativeBrowserOverlap: true,
          onPresentationReady,
        }),
      { initialProps: { layer: 20 } },
    );
    try {
      act(() => result.current(scope));
      expect(scope.inert).toBe(true);
      expect(scope.style.visibility).toBe("hidden");
      expect(scope.style.display).toBe("");
      expect(document.activeElement).toBe(opener);
      // Flyout/layout changes retain the actual scope registration and token.
      act(() => rerender({ layer: 30 }));
      expect(guard).toHaveBeenCalledTimes(1);
      await act(async () => {
        admit(true);
      });
      expect(scope.inert).toBe(false);
      expect(scope.style.visibility).toBe("");
      expect(onPresentationReady).toHaveBeenCalledOnce();
      unmount();
      expect(release).toHaveBeenCalledOnce();
    } finally {
      unmount();
      uninstall();
    }
  });

  it("cancels pending admission on scope detach without exposing a late completion", async () => {
    let admit!: (ready: boolean) => void;
    const release = vi.fn();
    const uninstall = installWebOverlayPresentationGuard(() => ({
      ready: new Promise<boolean>((resolve) => {
        admit = resolve;
      }),
      release,
    }));
    const onPresentationReady = vi.fn();
    const { result, unmount } = renderHook(() =>
      useWebOverlayRegistration({
        active: true,
        layer: 20,
        onKeyDown: () => false,
        nativeBrowserOverlap: true,
        onPresentationReady,
      }),
    );
    try {
      act(() => result.current(scope));
      act(() => result.current(null));
      await act(async () => {
        admit(true);
      });
      expect(release).toHaveBeenCalledOnce();
      expect(onPresentationReady).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(opener);
    } finally {
      unmount();
      uninstall();
    }
  });

  it("admits an already open menu when the first native page installs protection", async () => {
    const onPresentationReady = vi.fn();
    const { result, unmount } = renderHook(() =>
      useWebOverlayRegistration({
        active: true,
        layer: 20,
        onKeyDown: () => false,
        nativeBrowserOverlap: true,
        onPresentationReady,
      }),
    );
    let uninstall = () => {};
    try {
      act(() => result.current(scope));
      let admit!: (ready: boolean) => void;
      const guard = vi.fn(() => ({
        ready: new Promise<boolean>((resolve) => {
          admit = resolve;
        }),
        release: vi.fn(),
      }));
      act(() => {
        uninstall = installWebOverlayPresentationGuard(guard);
      });
      expect(scope.inert).toBe(true);
      expect(guard).toHaveBeenCalledOnce();
      await act(async () => {
        admit(true);
      });
      expect(scope.inert).toBe(false);
    } finally {
      unmount();
      uninstall();
    }
  });
});

/** Exercise the Electron adapter in this existing DOM suite without a browser/runtime. */
/** Backdrop and keyboard panel deliberately have different scopes. */
function BlockingAdmissionProbe({
  active = true,
  identity,
  onAdmissionFailed,
  onFocusRequest,
}: {
  active?: boolean;
  identity?: unknown;
  onAdmissionFailed: () => void;
  onFocusRequest?: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const { ready, retainNode } = useWebOverlayPresentationLifetime({
    active,
    identity,
    nativeBrowserOverlap: true,
    onAdmissionFailed,
  });
  const setScope = useWebOverlayRegistration({
    active: active && ready,
    layer: 40,
    onKeyDown: () => false,
  });
  useEffect(() => {
    if (!active || !ready) return;
    const timer = setTimeout(() => {
      onFocusRequest?.();
      input.current?.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, [active, ready, onFocusRequest]);
  if (!active || !ready) return null;
  return (
    <div ref={retainNode} data-blocking-root>
      <button data-backdrop type="button">
        Dismiss
      </button>
      <div ref={setScope}>
        <input ref={input} autoFocus data-editor />
      </div>
    </div>
  );
}

describe("blocking web presentation lifetime", () => {
  afterEach(() => {
    cleanup();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("withholds the whole backdrop and autofocus subtree until admission", async () => {
    let admit!: (ready: boolean) => void;
    const release = vi.fn();
    const focusRequest = vi.fn();
    const uninstall = installWebOverlayPresentationGuard(() => ({
      ready: new Promise<boolean>((resolve) => {
        admit = resolve;
      }),
      release,
    }));
    try {
      const view = render(
        <BlockingAdmissionProbe onAdmissionFailed={vi.fn()} onFocusRequest={focusRequest} />,
      );
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(document.querySelector("[data-backdrop]")).toBeNull();
      expect(document.querySelector("[data-editor]")).toBeNull();
      expect(focusRequest).not.toHaveBeenCalled();
      await act(async () => {
        admit(true);
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(document.querySelector("[data-backdrop]")).not.toBeNull();
      expect(document.activeElement).toBe(document.querySelector("[data-editor]"));
      expect(focusRequest).toHaveBeenCalledOnce();
      view.unmount();
      await act(async () => {});
      expect(release).toHaveBeenCalledOnce();
    } finally {
      uninstall();
    }
  });

  it("reports failed hide acknowledgement without mounting a misleading modal", async () => {
    const close = vi.fn();
    const release = vi.fn();
    const uninstall = installWebOverlayPresentationGuard(() => ({
      ready: Promise.resolve(false),
      release,
    }));
    try {
      const view = render(<BlockingAdmissionProbe onAdmissionFailed={close} />);
      await act(async () => {});
      expect(close).toHaveBeenCalledOnce();
      expect(document.querySelector("[data-blocking-root]")).toBeNull();
      view.unmount();
      await act(async () => {});
      expect(release).toHaveBeenCalledOnce();
    } finally {
      uninstall();
    }
  });

  it("fences late admission after request replacement and close", async () => {
    const replies: Array<(ready: boolean) => void> = [];
    const releases: Array<ReturnType<typeof vi.fn>> = [];
    const close = vi.fn();
    const uninstall = installWebOverlayPresentationGuard(() => {
      const release = vi.fn();
      releases.push(release);
      return { ready: new Promise<boolean>((resolve) => replies.push(resolve)), release };
    });
    try {
      const view = render(<BlockingAdmissionProbe identity="first" onAdmissionFailed={close} />);
      view.rerender(<BlockingAdmissionProbe identity="second" onAdmissionFailed={close} />);
      await act(async () => {
        replies[0]!(false);
      });
      expect(close).not.toHaveBeenCalled();
      expect(document.querySelector("[data-editor]")).toBeNull();
      view.unmount();
      await act(async () => {
        replies[1]!(true);
      });
      expect(document.querySelector("[data-editor]")).toBeNull();
      expect(releases).toHaveLength(2);
      for (const release of releases) expect(release).toHaveBeenCalledOnce();
    } finally {
      uninstall();
    }
  });

  it("retains ownership through actual closing DOM removal, independently of another overlay", async () => {
    const releases: Array<ReturnType<typeof vi.fn>> = [];
    const uninstall = installWebOverlayPresentationGuard(() => {
      const release = vi.fn();
      releases.push(release);
      return { ready: Promise.resolve(true), release };
    });
    const closingNode = document.createElement("div");
    document.body.append(closingNode);
    try {
      const first = renderHook(() =>
        useWebOverlayPresentationLifetime({
          active: true,
          nativeBrowserOverlap: true,
          onAdmissionFailed: vi.fn(),
        }),
      );
      const second = renderHook(() =>
        useWebOverlayPresentationLifetime({
          active: true,
          nativeBrowserOverlap: true,
          onAdmissionFailed: vi.fn(),
        }),
      );
      act(() => first.result.current.retainNode(closingNode));
      await act(async () => {});
      first.unmount();
      await act(async () => {});
      expect(releases[0]).not.toHaveBeenCalled();
      expect(releases[1]).not.toHaveBeenCalled();
      closingNode.remove();
      await act(async () => {});
      expect(releases[0]).toHaveBeenCalledOnce();
      expect(releases[1]).not.toHaveBeenCalled();
      second.unmount();
      await act(async () => {});
      expect(releases[1]).toHaveBeenCalledOnce();
    } finally {
      closingNode.remove();
      uninstall();
    }
  });

  it("acquires synchronously when the first native page installs its guard over an open modal", async () => {
    const release = vi.fn();
    const guard = vi.fn(() => ({ ready: Promise.resolve(true), release }));
    const view = render(<BlockingAdmissionProbe onAdmissionFailed={vi.fn()} />);
    expect(document.querySelector("[data-editor]")).not.toBeNull();
    let uninstall!: () => void;
    act(() => {
      uninstall = installWebOverlayPresentationGuard(guard);
      // The native creator can only run after installation returns.
      expect(guard).toHaveBeenCalledOnce();
    });
    try {
      expect(document.querySelector("[data-blocking-root]")).toBeNull();
      await act(async () => {});
      expect(document.querySelector("[data-blocking-root]")).not.toBeNull();
      view.unmount();
      await act(async () => {});
      expect(release).toHaveBeenCalledOnce();
    } finally {
      uninstall();
    }
  });

  it("reports failed registration admission once and ignores detached late failures", async () => {
    const replies: Array<(ready: boolean) => void> = [];
    const uninstall = installWebOverlayPresentationGuard(() => ({
      ready: new Promise<boolean>((resolve) => replies.push(resolve)),
      release: vi.fn(),
    }));
    const failed = vi.fn();
    const scope = document.createElement("div");
    document.body.append(scope);
    const view = renderHook(() =>
      useWebOverlayRegistration({
        active: true,
        layer: 40,
        onKeyDown: () => false,
        nativeBrowserOverlap: true,
        onPresentationFailed: failed,
      }),
    );
    try {
      act(() => view.result.current(scope));
      await act(async () => {
        replies[0]!(false);
      });
      expect(failed).toHaveBeenCalledOnce();
      act(() => view.result.current(null));
      act(() => view.result.current(scope));
      view.unmount();
      await act(async () => {
        replies[1]!(false);
      });
      expect(failed).toHaveBeenCalledOnce();
    } finally {
      view.unmount();
      uninstall();
    }
  });

  it("leaves command-center return focus with its existing caller owner", () => {
    const opener = document.createElement("button");
    const scope = document.createElement("div");
    const input = document.createElement("input");
    scope.append(input);
    document.body.append(opener, scope);
    opener.focus();
    const { result, rerender, unmount } = renderHook(
      ({ active }) =>
        useWebOverlayRegistration({
          active,
          layer: 40,
          onKeyDown: () => false,
          restoreFocusOnClose: false,
        }),
      { initialProps: { active: true } },
    );
    act(() => result.current(scope));
    input.focus();
    const restore = vi.spyOn(opener, "focus");
    rerender({ active: false });
    expect(restore).not.toHaveBeenCalled();
    unmount();
    expect(restore).not.toHaveBeenCalled();
  });
});

describe("native menu still lifetime", () => {
  const originalDecode = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "decode");
  async function adapterFixture(initialize = true) {
    vi.resetModules();
    const decode = vi.fn<() => Promise<void>>().mockResolvedValue();
    Object.defineProperty(HTMLImageElement.prototype, "decode", {
      configurable: true,
      value: decode,
    });
    const host = await import("@/desktop/host");
    const presentation = await import("./overlay-presentation");
    const target = { browserId: "menu-page", webContentsId: 123, revision: 4 };
    const frame = {
      ...target,
      bounds: { x: 10, y: 20, width: 100, height: 80 },
      dataUrl: "data:image/png;base64,AQID",
    };
    const views = {
      prepareOverlay: vi.fn(async (_token: string) => [target]),
      commitOverlay: vi.fn(async (_input: { token: string; frames: (typeof target)[] }) => true),
      captureOverlay: vi.fn(async () => frame as typeof frame | null),
      endOverlay: vi.fn(async (_token: string) => {}),
    };
    let receive!: (payload: unknown) => void;
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(
      (
        _event: string,
        listener: (payload: unknown) => void,
      ): (() => void) | Promise<() => void> => {
        receive = listener;
        return Promise.resolve(unsubscribe);
      },
    );
    vi.spyOn(host, "getDesktopHost").mockReturnValue({
      browser: { views },
      events: { on: subscribe },
    } as unknown as NonNullable<ReturnType<typeof host.getDesktopHost>>);
    const native = await import("../desktop/browser/native-overlays.electron");
    if (initialize) native.ensureNativeBrowserOverlayProtection();
    const scope = document.createElement("div");
    scope.inert = false;
    document.body.append(scope);
    return {
      decode,
      presentation,
      native,
      views,
      target,
      frame,
      scope,
      subscribe,
      unsubscribe,
      invalidate: (payload: unknown) => receive(payload),
    };
  }

  afterEach(() => {
    vi.useRealTimers();
    if (originalDecode) Object.defineProperty(HTMLImageElement.prototype, "decode", originalDecode);
    else Reflect.deleteProperty(HTMLImageElement.prototype, "decode");
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("decodes a staged frame before hide ACK admits interactive content", async () => {
    const { presentation, views, scope, decode, target } = await adapterFixture();
    let finishDecode!: () => void;
    decode.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishDecode = resolve;
        }),
    );
    let finishCommit!: (ready: boolean) => void;
    views.commitOverlay.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finishCommit = resolve;
        }),
    );
    const lease = presentation.prepareWebOverlayPresentation(scope)!;
    try {
      await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce());
      expect(document.querySelector("img")).not.toBeNull();
      expect(views.commitOverlay).not.toHaveBeenCalled();
      expect(scope.inert).toBe(true);
      finishDecode();
      await vi.waitFor(() => expect(views.commitOverlay).toHaveBeenCalledOnce());
      expect(views.commitOverlay.mock.calls[0]![0].frames).toEqual([target]);
      expect(scope.inert).toBe(true);
      finishCommit(true);
      expect(await lease.ready).toBe(true);
      expect(scope.inert).toBe(false);
    } finally {
      lease.release();
    }
  });

  it("keeps one decoded frame and distinct canonical tokens until the last nested scope releases", async () => {
    const { presentation, views, scope } = await adapterFixture();
    const nested = document.createElement("div");
    document.body.append(nested);
    const first = presentation.prepareWebOverlayPresentation(scope)!;
    const second = presentation.prepareWebOverlayPresentation(nested)!;
    try {
      expect(await first.ready).toBe(true);
      expect(await second.ready).toBe(true);
      expect(views.prepareOverlay).toHaveBeenCalledTimes(2);
      expect(views.prepareOverlay.mock.calls[0]![0]).not.toBe(
        views.prepareOverlay.mock.calls[1]![0],
      );
      expect(views.captureOverlay).toHaveBeenCalledOnce();
      first.release();
      expect(views.endOverlay).not.toHaveBeenCalled();
      expect(document.querySelector("img")).not.toBeNull();
      second.release();
      expect(views.endOverlay).toHaveBeenCalledTimes(2);
      expect(document.querySelector("img")).toBeNull();
    } finally {
      first.release();
      second.release();
    }
  });

  it("removes a rejected stale frame before explicit blank commit", async () => {
    const { presentation, views, scope } = await adapterFixture();
    views.commitOverlay.mockResolvedValueOnce(false).mockImplementationOnce(async (input) => {
      expect(input.frames).toEqual([]);
      expect(document.querySelector("img")).toBeNull();
      return true;
    });
    const lease = presentation.prepareWebOverlayPresentation(scope)!;
    try {
      expect(await lease.ready).toBe(true);
    } finally {
      lease.release();
    }
  });

  it("admits blank after decode timeout and cannot paint the late decoded result", async () => {
    const { presentation, views, scope, decode } = await adapterFixture();
    vi.useFakeTimers();
    let finishDecode!: () => void;
    decode.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishDecode = resolve;
        }),
    );
    const lease = presentation.prepareWebOverlayPresentation(scope)!;
    try {
      await vi.advanceTimersByTimeAsync(250);
      expect(await lease.ready).toBe(true);
      expect(views.commitOverlay.mock.calls[0]![0].frames).toEqual([]);
      expect(document.querySelector("img")).toBeNull();
      finishDecode();
      await Promise.resolve();
      expect(document.querySelector("img")).toBeNull();
    } finally {
      lease.release();
    }
  });

  it("fails closed on hide rejection and retires the staged image", async () => {
    const { presentation, views, scope } = await adapterFixture();
    views.commitOverlay.mockRejectedValueOnce(new Error("host closed"));
    const lease = presentation.prepareWebOverlayPresentation(scope)!;
    expect(await lease.ready).toBe(false);
    expect(scope.inert).toBe(true);
    expect(document.querySelector("img")).toBeNull();
    expect(views.commitOverlay).toHaveBeenCalledOnce();
    expect(views.endOverlay).toHaveBeenCalledOnce();
    lease.release();
  });

  it("cancels a decoded-frame preparation without committing after scope removal", async () => {
    const { presentation, views, scope, decode } = await adapterFixture();
    let finishDecode!: () => void;
    decode.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishDecode = resolve;
        }),
    );
    const lease = presentation.prepareWebOverlayPresentation(scope)!;
    await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce());
    lease.release();
    finishDecode();
    expect(await lease.ready).toBe(false);
    expect(views.commitOverlay).not.toHaveBeenCalled();
    expect(document.querySelector("img")).toBeNull();
  });

  it("does not admit a released scope when its hide acknowledgement arrives late", async () => {
    const { presentation, views, scope } = await adapterFixture();
    let acknowledge!: (ready: boolean) => void;
    views.commitOverlay.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          acknowledge = resolve;
        }),
    );
    const lease = presentation.prepareWebOverlayPresentation(scope)!;
    await vi.waitFor(() => expect(views.commitOverlay).toHaveBeenCalledOnce());
    lease.release();
    acknowledge(true);
    expect(await lease.ready).toBe(false);
    expect(views.endOverlay).toHaveBeenCalledOnce();
    expect(document.querySelector("img")).toBeNull();
  });

  it("keeps hide timeout fail-closed even if acknowledgement later succeeds", async () => {
    const { presentation, views, scope } = await adapterFixture();
    vi.useFakeTimers();
    let acknowledge!: (ready: boolean) => void;
    views.commitOverlay.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          acknowledge = resolve;
        }),
    );
    const lease = presentation.prepareWebOverlayPresentation(scope)!;
    await vi.advanceTimersByTimeAsync(500);
    expect(await lease.ready).toBe(false);
    expect(scope.inert).toBe(true);
    expect(document.querySelector("img")).toBeNull();
    acknowledge(true);
    await Promise.resolve();
    expect(scope.inert).toBe(true);
    expect(views.endOverlay).toHaveBeenCalledOnce();
    lease.release();
  });

  it("retires a cancelled nested preparation without releasing the active outer token", async () => {
    const { presentation, views, scope, target } = await adapterFixture();
    const first = presentation.prepareWebOverlayPresentation(scope)!;
    expect(await first.ready).toBe(true);
    let complete!: (targets: (typeof target)[]) => void;
    views.prepareOverlay.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const nested = document.createElement("div");
    document.body.append(nested);
    const second = presentation.prepareWebOverlayPresentation(nested)!;
    await vi.waitFor(() => expect(views.prepareOverlay).toHaveBeenCalledTimes(2));
    second.release();
    complete([target]);
    expect(await second.ready).toBe(false);
    expect(views.commitOverlay).toHaveBeenCalledOnce();
    expect(views.endOverlay).toHaveBeenCalledExactlyOnceWith(
      views.prepareOverlay.mock.calls[1]![0],
    );
    expect(document.querySelector("img")).not.toBeNull();
    first.release();
    expect(views.endOverlay).toHaveBeenCalledTimes(2);
  });

  it("opens over blank on frame failure, then releases the same token without focus", async () => {
    const { presentation, views, scope } = await adapterFixture();
    views.captureOverlay.mockRejectedValueOnce(new Error("capture timed out"));
    const lease = presentation.prepareWebOverlayPresentation(scope)!;
    try {
      expect(await lease.ready).toBe(true);
      expect(scope.inert).toBe(false);
      expect(document.querySelector("img")).toBeNull();
      lease.release();
      const token = views.prepareOverlay.mock.calls[0]![0];
      expect(views.endOverlay).toHaveBeenCalledExactlyOnceWith(token);
    } finally {
      lease.release();
    }
  });

  it("removes a painted still on navigation and rejects a locally invalidated late reply", async () => {
    const { presentation, native, views, frame, target, scope, invalidate } =
      await adapterFixture();
    const first = presentation.prepareWebOverlayPresentation(scope)!;
    let second: typeof first | undefined;
    try {
      expect(await first.ready).toBe(true);
      expect(document.querySelector("img")?.getAttribute("aria-hidden")).toBe("true");
      invalidate({ ...target, revision: 5 });
      expect(document.querySelector("img")).toBeNull();
      first.release();
      let finish!: (value: typeof frame) => void;
      views.captureOverlay.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      second = presentation.prepareWebOverlayPresentation(scope)!;
      await Promise.resolve();
      native.clearNativeBrowserOverlayFrames(target.browserId);
      finish(frame);
      expect(await second.ready).toBe(true);
      expect(document.querySelector("img")).toBeNull();
    } finally {
      first.release();
      second?.release();
    }
  });

  it("releases admission arriving after unmount without requesting or painting a frame", async () => {
    const { presentation, views, target, scope } = await adapterFixture();
    let admit!: (value: (typeof target)[]) => void;
    views.prepareOverlay.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          admit = resolve;
        }),
    );
    const lease = presentation.prepareWebOverlayPresentation(scope)!;
    lease.release();
    admit([target]);
    expect(await lease.ready).toBe(false);
    expect(views.captureOverlay).not.toHaveBeenCalled();
    expect(views.endOverlay).toHaveBeenCalledOnce();
    expect(document.querySelector("img")).toBeNull();
  });
  it("retries successfully after synchronous listener attachment fails without claiming installed state", async () => {
    const { presentation, native, views, scope, subscribe, unsubscribe } =
      await adapterFixture(false);
    subscribe.mockImplementationOnce(() => {
      throw new Error("injected listener attach failure");
    });
    expect(() => native.ensureNativeBrowserOverlayProtection()).toThrow(
      "injected listener attach failure",
    );
    expect(presentation.hasWebOverlayPresentationGuard()).toBe(false);
    expect(unsubscribe).not.toHaveBeenCalled();
    native.ensureNativeBrowserOverlayProtection();
    native.ensureNativeBrowserOverlayProtection();
    expect(subscribe).toHaveBeenCalledTimes(2);
    const lease = presentation.prepareWebOverlayPresentation(scope)!;
    try {
      expect(await lease.ready).toBe(true);
      expect(views.captureOverlay).toHaveBeenCalledOnce();
    } finally {
      lease.release();
    }
  });

  it("rolls back a partially installed guard and attached listener before successful retry", async () => {
    const { presentation, native, scope, subscribe, unsubscribe } = await adapterFixture(false);
    const stopFailure = presentation.subscribeWebOverlayPresentationGuard(
      vi.fn().mockImplementationOnce(() => {
        throw new Error("injected scope setup failure");
      }),
    );
    try {
      expect(() => native.ensureNativeBrowserOverlayProtection()).toThrow(
        "Web overlay guard notification failed",
      );
      expect(presentation.hasWebOverlayPresentationGuard()).toBe(false);
      expect(() => native.ensureNativeBrowserOverlayProtection()).toThrow(
        "listener cleanup is pending",
      );
      await Promise.resolve();
      expect(unsubscribe).toHaveBeenCalledOnce();
      native.ensureNativeBrowserOverlayProtection();
      expect(subscribe).toHaveBeenCalledTimes(2);
      const lease = presentation.prepareWebOverlayPresentation(scope)!;
      try {
        expect(await lease.ready).toBe(true);
      } finally {
        lease.release();
      }
    } finally {
      stopFailure();
    }
  });

  it("refuses another subscription when failed setup cannot retire the first listener", async () => {
    const { presentation, native, subscribe, unsubscribe } = await adapterFixture(false);
    unsubscribe.mockImplementationOnce(() => {
      throw new Error("injected listener detach failure");
    });
    const stopFailure = presentation.subscribeWebOverlayPresentationGuard(
      vi.fn().mockImplementationOnce(() => {
        throw new Error("injected setup failure");
      }),
    );
    try {
      expect(() => native.ensureNativeBrowserOverlayProtection()).toThrow(
        "Web overlay guard notification failed",
      );
      await Promise.resolve();
      expect(() => native.ensureNativeBrowserOverlayProtection()).toThrow(
        "listener cleanup failed",
      );
      expect(presentation.hasWebOverlayPresentationGuard()).toBe(false);
      expect(subscribe).toHaveBeenCalledOnce();
    } finally {
      stopFailure();
    }
  });
  it("retires a synchronous unsubscribe handle before retry after setup failure", async () => {
    const { presentation, native, subscribe, unsubscribe, scope } = await adapterFixture(false);
    subscribe.mockReturnValueOnce(unsubscribe);
    const stopFailure = presentation.subscribeWebOverlayPresentationGuard(
      vi.fn().mockImplementationOnce(() => {
        throw new Error("injected scope setup failure");
      }),
    );
    try {
      expect(() => native.ensureNativeBrowserOverlayProtection()).toThrow(
        "Web overlay guard notification failed",
      );
      expect(presentation.hasWebOverlayPresentationGuard()).toBe(false);
      await Promise.resolve();
      expect(unsubscribe).toHaveBeenCalledOnce();
      native.ensureNativeBrowserOverlayProtection();
      expect(subscribe).toHaveBeenCalledTimes(2);
      const lease = presentation.prepareWebOverlayPresentation(scope)!;
      try {
        expect(await lease.ready).toBe(true);
      } finally {
        lease.release();
      }
    } finally {
      stopFailure();
    }
  });
});
