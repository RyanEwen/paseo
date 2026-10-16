/**
 * @vitest-environment jsdom
 */
import React, { act, createContext, useContext, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A faithful stand-in for `@gorhom/portal`: it renders *nothing* where it sits and hands its
 * element to a host somewhere else in the tree, which is what makes the real thing lose context.
 * A passthrough fake would keep context and quietly pass every test in this file — which is
 * exactly what happened, and why the menu sheet shipped broken.
 */
const portalStore = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let node: React.ReactNode = null;
  return {
    put(next: React.ReactNode) {
      node = next;
      for (const listener of listeners) listener();
    },
    read: () => node,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reset() {
      node = null;
      listeners.clear();
    },
  };
});

vi.mock("@gorhom/portal", async () => {
  const actual = await vi.importActual<typeof import("@gorhom/portal/lib/typescript/index")>(
    "@gorhom/portal/lib/module/index",
  );
  return {
    ...actual,
    Portal: (props: React.ComponentProps<typeof actual.Portal>) => {
      if (sheetControls.actual) return <ObservedPortal {...props} />;
      return <LegacyPortal {...props} />;
    },
  };
  function LegacyPortal({ children }: React.PropsWithChildren) {
    React.useEffect(() => {
      portalStore.put(children);
      return () => portalStore.put(null);
    }, [children]);
    return null;
  }
  function ObservedPortal(props: React.ComponentProps<typeof actual.Portal>) {
    const { handleOnMount } = props;
    const publish = React.useCallback(
      (render: () => void) => {
        const attempt = () => handleOnMount?.(render);
        sheetControls.publications.push(attempt);
        if (!sheetControls.holdPublication) attempt();
      },
      [handleOnMount],
    );
    return <actual.Portal {...props} handleOnMount={publish} handleOnUpdate={publish} />;
  }
});

// Keep the portal mounted after the dismiss callback, as a real closing sheet can.
const sheetControls = vi.hoisted(() => ({
  actual: false,
  holdPublication: false,
  publications: [] as Array<() => void>,
  finishCloses: new Map<string, () => void>(),
  closes: [] as string[],
  finishDismiss: () => {},
  presentCalls: 0,
  initialDismissWithoutInner: 0,
  reset() {
    this.actual = false;
    this.holdPublication = false;
    this.publications = [];
    this.finishCloses.clear();
    this.closes = [];
    this.presentCalls = 0;
    this.initialDismissWithoutInner = 0;
  },
}));

vi.mock("@gorhom/bottom-sheet", async () => {
  const { default: ActualModal } = await vi.importActual<
    typeof import("@gorhom/bottom-sheet/lib/typescript/components/bottomSheetModal/BottomSheetModal")
  >("@gorhom/bottom-sheet/lib/module/components/bottomSheetModal/BottomSheetModal");
  return {
    BottomSheetModalProvider: ({ children }: { children?: React.ReactNode }) =>
      React.createElement("div", { "data-bottom-sheet-provider": true }, children),
    BottomSheetModal: React.forwardRef<React.ElementRef<typeof ActualModal>, NodeModalProps>(
      function ModalForTest(props, ref) {
        if (sheetControls.actual)
          return (
            <ActualModal {...props} ref={ref}>
              {props.children}
            </ActualModal>
          );
        return <LegacySheet {...props} ref={ref} />;
      },
    ),
  };
});

interface NodeModalProps extends Omit<
  React.ComponentPropsWithoutRef<typeof ActualModal>,
  "children"
> {
  children?: React.ReactNode;
}

const LegacySheet = React.forwardRef<React.ElementRef<typeof ActualModal>, NodeModalProps>(
  function LegacySheet({ children, stackBehavior, containerComponent: Container, onDismiss }, ref) {
    const [mounted, setMounted] = React.useState(!Container);
    const inner = React.useRef(false);
    const setInnerNode = React.useCallback((node: HTMLDivElement | null) => {
      inner.current = node !== null;
    }, []);
    sheetControls.finishDismiss = () => setMounted(false);
    React.useImperativeHandle(
      ref,
      () => ({
        close: () => {},
        forceClose: () => {},
        snapToIndex: () => {},
        snapToPosition: () => {},
        expand: () => {},
        collapse: () => {},
        present: () => {
          sheetControls.presentCalls++;
          setMounted(true);
        },
        dismiss: () => {
          // Installed Gorhom INITIAL/no-inner-ref: first dismiss cannot finish.
          if (!inner.current) {
            sheetControls.initialDismissWithoutInner++;
            return;
          }
          onDismiss?.();
        },
      }),
      [onDismiss],
    );
    if (!mounted) return null;
    const body = (
      <div ref={setInnerNode} data-stack-behavior={stackBehavior}>
        {Container ? (
          <button data-sheet-backdrop type="button">
            Dismiss sheet
          </button>
        ) : null}
        {children}
      </div>
    );
    return (
      <LegacyPortalExport>{Container ? <Container>{body}</Container> : body}</LegacyPortalExport>
    );
  },
);

import { Portal as LegacyPortalExport } from "@gorhom/portal";
import { installWebOverlayPresentationGuard } from "@/lib/overlay-presentation";
import {
  IsolatedBottomSheetModal,
  type IsolatedBottomSheetModalRef,
  type ContextBridge,
  useIsolatedBottomSheetVisibility,
} from ".";
import { useIsInsideBottomSheet } from "@/components/ui/bottom-sheet-scope";

/** Renders whatever the portal is currently holding, from its own place in the tree. */
function PortalHostProbe() {
  const node = useSyncExternalStore(portalStore.subscribe, portalStore.read, portalStore.read);
  return <div data-portal-host>{node}</div>;
}

const LabelContext = createContext("unbridged");

function Label() {
  return <div data-label={useContext(LabelContext)} />;
}

function BottomSheetScopeProbe() {
  return <div data-inside-bottom-sheet={useIsInsideBottomSheet().toString()} />;
}

describe("IsolatedBottomSheetModal presentation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    portalStore.reset();
  });

  function stackBehaviors(): (string | null)[] {
    return Array.from(container.querySelectorAll("[data-stack-behavior]")).map((node) =>
      node.getAttribute("data-stack-behavior"),
    );
  }

  it("defaults sibling top-level sheets to push instead of replacing by React ancestry", () => {
    act(() => {
      root.render(
        <>
          <IsolatedBottomSheetModal contextBridge={null}>Settings</IsolatedBottomSheetModal>
          <PortalHostProbe />
        </>,
      );
    });
    expect(stackBehaviors()).toEqual(["push"]);

    act(() => {
      root.render(
        <>
          <IsolatedBottomSheetModal contextBridge={null}>Diagnostic</IsolatedBottomSheetModal>
          <PortalHostProbe />
        </>,
      );
    });
    expect(stackBehaviors()).toEqual(["push"]);
  });

  it("only replaces when the callsite asks for replacement", () => {
    act(() => {
      root.render(
        <>
          <IsolatedBottomSheetModal presentation="replace" contextBridge={null}>
            Selector
          </IsolatedBottomSheetModal>
          <PortalHostProbe />
        </>,
      );
    });

    expect(stackBehaviors()).toEqual(["replace"]);
  });
});

describe("IsolatedBottomSheetModal context bridging", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    portalStore.reset();
  });

  function renderSheet(contextBridge: ContextBridge | null) {
    act(() => {
      root.render(
        <>
          <LabelContext.Provider value="from callsite">
            <IsolatedBottomSheetModal contextBridge={contextBridge}>
              <Label />
            </IsolatedBottomSheetModal>
          </LabelContext.Provider>
          {/* Outside the provider, standing in for the app-root portal host. */}
          <PortalHostProbe />
        </>,
      );
    });
    return container.querySelector("[data-label]")?.getAttribute("data-label");
  }

  it("loses callsite context without a bridge", () => {
    expect(renderSheet(null)).toBe("unbridged");
  });

  it("carries callsite context across the portal when bridged", () => {
    const bridge: ContextBridge = (children) => (
      <LabelContext.Provider value="from callsite">{children}</LabelContext.Provider>
    );
    expect(renderSheet(bridge)).toBe("from callsite");
  });

  it("marks content rendered through the modal as inside a bottom sheet", () => {
    act(() => {
      root.render(
        <>
          <BottomSheetScopeProbe />
          <IsolatedBottomSheetModal contextBridge={null}>
            <BottomSheetScopeProbe />
          </IsolatedBottomSheetModal>
          <PortalHostProbe />
        </>,
      );
    });

    expect(
      Array.from(container.querySelectorAll("[data-inside-bottom-sheet]")).map((node) =>
        node.getAttribute("data-inside-bottom-sheet"),
      ),
    ).toEqual(["false", "true"]);
  });
});

function ControlledOverlapSheet({ visible, onClose }: { visible: boolean; onClose(): void }) {
  const { sheetRef, handleSheetChange, handleSheetDismiss } = useIsolatedBottomSheetVisibility({
    visible,
    onClose,
  });
  return (
    <IsolatedBottomSheetModal
      ref={sheetRef}
      contextBridge={null}
      nativeBrowserOverlap
      onChange={handleSheetChange}
      onDismiss={handleSheetDismiss}
    >
      <input autoFocus data-sheet-editor />
    </IsolatedBottomSheetModal>
  );
}

describe("IsolatedBottomSheetModal explicit web overlap lifetime", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    sheetControls.reset();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    portalStore.reset();
  });

  it("admits the real portal container before children, retaining its lease past onDismiss until removal", async () => {
    let admit!: (ready: boolean) => void;
    const release = vi.fn<() => void>();
    const dismissed = vi.fn<() => void>();
    const ref = React.createRef<IsolatedBottomSheetModalRef>();
    const uninstall = installWebOverlayPresentationGuard(() => ({
      ready: new Promise<boolean>((resolve) => {
        admit = resolve;
      }),
      release,
    }));
    try {
      act(() =>
        root.render(
          <>
            <IsolatedBottomSheetModal
              ref={ref}
              contextBridge={null}
              nativeBrowserOverlap
              onDismiss={dismissed}
            >
              <input autoFocus data-sheet-editor />
            </IsolatedBottomSheetModal>
            <PortalHostProbe />
          </>,
        ),
      );
      act(() => ref.current?.present());
      expect(container.querySelector("[data-sheet-editor]")).toBeNull();
      expect(container.querySelector("[data-sheet-backdrop]")).toBeNull();
      await act(async () => {
        admit(true);
      });
      expect(container.querySelector("[data-sheet-backdrop]")).not.toBeNull();
      expect(document.activeElement).toBe(container.querySelector("[data-sheet-editor]"));
      act(() => ref.current?.dismiss());
      expect(dismissed).toHaveBeenCalledOnce();
      expect(container.querySelector("[data-sheet-backdrop]")).not.toBeNull();
      expect(release).not.toHaveBeenCalled();
      await act(async () => {
        sheetControls.finishDismiss();
      });
      expect(container.querySelector("[data-sheet-editor]")).toBeNull();
      expect(container.querySelector("[data-sheet-backdrop]")).toBeNull();
      expect(release).toHaveBeenCalledOnce();
    } finally {
      await act(async () => root.render(null));
      uninstall();
    }
  });

  it("cancels controlled close before framework present, ignores late admission and permits subsequent presentation", async () => {
    const replies: Array<(ready: boolean) => void> = [];
    const releases: Array<ReturnType<typeof vi.fn<() => void>>> = [];
    const onClose = vi.fn<() => void>();
    const uninstall = installWebOverlayPresentationGuard(() => {
      const release = vi.fn<() => void>();
      releases.push(release);
      return { ready: new Promise<boolean>((resolve) => replies.push(resolve)), release };
    });
    const show = (visible: boolean) =>
      root.render(
        <>
          <ControlledOverlapSheet visible={visible} onClose={onClose} />
          <PortalHostProbe />
        </>,
      );
    try {
      act(() => show(true));
      expect(sheetControls.presentCalls).toBe(0);
      expect(portalStore.read()).toBeNull();
      await act(async () => {
        show(false);
      });
      expect(releases[0]).toHaveBeenCalledOnce();
      await act(async () => {
        replies[0]!(true);
      });
      expect(sheetControls.presentCalls).toBe(0);
      expect(sheetControls.initialDismissWithoutInner).toBe(0);
      expect(portalStore.read()).toBeNull();
      expect(container.querySelector("[data-sheet-editor]")).toBeNull();
      expect(onClose).not.toHaveBeenCalled();
      act(() => show(true));
      await act(async () => {
        replies[1]!(true);
      });
      expect(sheetControls.presentCalls).toBe(1);
      expect(container.querySelector("[data-sheet-editor]")).not.toBeNull();
      await act(async () => root.render(null));
      expect(releases[1]).toHaveBeenCalledOnce();
    } finally {
      await act(async () => root.render(null));
      uninstall();
    }
  });

  it("cancels an imperative pending dismiss without relying on INITIAL forceClose or a manual portal finish", async () => {
    let admit!: (ready: boolean) => void;
    const release = vi.fn<() => void>();
    const dismissed = vi.fn<() => void>();
    const ref = React.createRef<IsolatedBottomSheetModalRef>();
    const uninstall = installWebOverlayPresentationGuard(() => ({
      ready: new Promise<boolean>((resolve) => {
        admit = resolve;
      }),
      release,
    }));
    try {
      act(() =>
        root.render(
          <>
            <IsolatedBottomSheetModal
              ref={ref}
              contextBridge={null}
              nativeBrowserOverlap
              onDismiss={dismissed}
            >
              <input autoFocus data-sheet-editor />
            </IsolatedBottomSheetModal>
            <PortalHostProbe />
          </>,
        ),
      );
      act(() => ref.current?.present());
      await act(async () => {
        ref.current?.dismiss();
      });
      expect(dismissed).toHaveBeenCalledOnce();
      expect(release).toHaveBeenCalledOnce();
      await act(async () => {
        admit(true);
      });
      expect(sheetControls.presentCalls).toBe(0);
      expect(sheetControls.initialDismissWithoutInner).toBe(0);
      expect(portalStore.read()).toBeNull();
      expect(container.querySelector("[data-sheet-editor]")).toBeNull();
    } finally {
      await act(async () => root.render(null));
      uninstall();
    }
  });

  it("cancels failed admission before framework present and permits a subsequent successful presentation", async () => {
    const failed = vi.fn<() => void>();
    const release = vi.fn<() => void>();
    const ref = React.createRef<IsolatedBottomSheetModalRef>();
    let attempts = 0;
    const uninstall = installWebOverlayPresentationGuard(() => ({
      ready: Promise.resolve(++attempts > 1),
      release,
    }));
    try {
      act(() =>
        root.render(
          <>
            <IsolatedBottomSheetModal
              ref={ref}
              contextBridge={null}
              nativeBrowserOverlap
              onDismiss={failed}
            >
              <input data-sheet-editor />
            </IsolatedBottomSheetModal>
            <PortalHostProbe />
          </>,
        ),
      );
      await act(async () => ref.current?.present());
      expect(failed).toHaveBeenCalledOnce();
      expect(container.querySelector("[data-sheet-editor]")).toBeNull();
      expect(container.querySelector("[data-sheet-backdrop]")).toBeNull();
      expect(sheetControls.presentCalls).toBe(0);
      expect(sheetControls.initialDismissWithoutInner).toBe(0);
      expect(portalStore.read()).toBeNull();
      expect(release).toHaveBeenCalledOnce();
      await act(async () => ref.current?.present());
      expect(sheetControls.presentCalls).toBe(1);
      expect(container.querySelector("[data-sheet-editor]")).not.toBeNull();
      expect(failed).toHaveBeenCalledOnce();
      await act(async () => root.render(null));
      expect(release).toHaveBeenCalledTimes(2);
    } finally {
      await act(async () => root.render(null));
      uninstall();
    }
  });
});

// Load compiled vendor entrypoints with their shipped declarations via importActual.
// This keeps vendor TS implementation files out of the app typecheck without a resolver alias.
// These stand-ins replace animation/layout machinery, not the modal scheduler,
// provider queue, portal reducer or publication effects under test.
vi.mock("react-native-reanimated", () => ({
  useSharedValue: (value: unknown) => React.useRef({ value }).current,
  Easing: { exp: (value: number) => value, out: (fn: (value: number) => number) => fn },
}));
vi.mock("@gorhom/bottom-sheet/lib/module/hooks/index", async () => {
  const internal = await vi.importActual<
    typeof import("@gorhom/bottom-sheet/lib/typescript/hooks/useBottomSheetModalInternal")
  >("@gorhom/bottom-sheet/lib/module/hooks/useBottomSheetModalInternal");
  return { ...internal };
});
vi.mock("@gorhom/bottom-sheet/lib/module/utilities/index", () => ({ print: () => {} }));
vi.mock("@gorhom/bottom-sheet/lib/module/components/bottomSheetHostingContainer/index", () => ({
  BottomSheetHostingContainer: () => null,
}));
vi.mock("@gorhom/bottom-sheet/lib/module/components/bottomSheet/index", () => ({
  default: React.forwardRef<
    import("@gorhom/bottom-sheet/lib/typescript/types").BottomSheetMethods,
    React.PropsWithChildren<{
      onClose(): void;
      onChange(index: number, position: number, type: number): void;
    }>
  >(function AnimatedSheetStandIn({ children, onClose, onChange }, ref) {
    const id = React.useId();
    React.useImperativeHandle(
      ref,
      () => ({
        snapToIndex: () => onChange(0, 0, 0),
        snapToPosition: () => {},
        expand: () => {},
        collapse: () => {},
        close: () => {
          sheetControls.closes.push(`close:${id}`);
        },
        forceClose: () => {
          sheetControls.closes.push(`forceClose:${id}`);
        },
      }),
      [id, onChange],
    );
    React.useLayoutEffect(() => {
      sheetControls.finishCloses.set(id, onClose);
      return () => {
        sheetControls.finishCloses.delete(id);
      };
    }, [id, onClose]);
    return (
      <div data-actual-sheet={id}>
        <button data-actual-backdrop type="button">
          Dismiss
        </button>
        {children}
      </div>
    );
  }),
}));

const { default: ActualModal } = await vi.importActual<
  typeof import("@gorhom/bottom-sheet/lib/typescript/components/bottomSheetModal/BottomSheetModal")
>("@gorhom/bottom-sheet/lib/module/components/bottomSheetModal/BottomSheetModal");
const { default: ActualProvider } = await vi.importActual<
  typeof import("@gorhom/bottom-sheet/lib/typescript/components/bottomSheetModalProvider/BottomSheetModalProvider")
>("@gorhom/bottom-sheet/lib/module/components/bottomSheetModalProvider/BottomSheetModalProvider");
const { BottomSheetModalContext } = await vi.importActual<
  typeof import("@gorhom/bottom-sheet/lib/typescript/contexts/modal/external")
>("@gorhom/bottom-sheet/lib/module/contexts/modal/external");
const { BottomSheetModalInternalContext } = await vi.importActual<
  typeof import("@gorhom/bottom-sheet/lib/typescript/contexts/modal/internal")
>("@gorhom/bottom-sheet/lib/module/contexts/modal/internal");
const { PortalStateContext } = await vi.importActual<
  typeof import("@gorhom/portal/lib/typescript/contexts/portal")
>("@gorhom/portal/lib/module/contexts/portal");

interface PendingFrame {
  id: number;
  callback: FrameRequestCallback;
  cancelled: boolean;
}

// Observes the real provider queue through its public dismiss result and wraps
// only mountSheet to record when its real implementation is entered/returned.
function ProviderReceipt({
  children,
  registration,
  portals,
}: React.PropsWithChildren<{
  registration: {
    mounts: string[];
    api: React.ContextType<typeof BottomSheetModalContext>;
    duringMount: (() => void) | null;
  };
  portals: { current: React.ContextType<typeof PortalStateContext> };
}>) {
  const inner = React.useContext(BottomSheetModalInternalContext);
  registration.api = React.useContext(BottomSheetModalContext);
  portals.current = React.useContext(PortalStateContext);
  const observed = React.useMemo(() => {
    if (!inner) throw new Error("Missing real modal provider");
    return {
      ...inner,
      mountSheet: (...args: Parameters<typeof inner.mountSheet>) => {
        registration.mounts.push(args[0]);
        inner.mountSheet(...args);
        registration.duringMount?.();
      },
    };
  }, [inner, registration]);
  return (
    <BottomSheetModalInternalContext.Provider value={observed}>
      {children}
    </BottomSheetModalInternalContext.Provider>
  );
}

describe("actual patched modal RAF and portal cancellation", () => {
  let container: HTMLDivElement;
  let root: Root;
  let frames: PendingFrame[];
  let registration: {
    mounts: string[];
    api: React.ContextType<typeof BottomSheetModalContext>;
    duringMount: (() => void) | null;
  };
  let portals: { current: React.ContextType<typeof PortalStateContext> };
  let release: ReturnType<typeof vi.fn<() => void>>;
  let uninstall: () => void;
  let dismissed: ReturnType<typeof vi.fn<() => void>>;
  let ref: React.RefObject<IsolatedBottomSheetModalRef | null>;

  beforeEach(() => {
    sheetControls.reset();
    sheetControls.actual = true;
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const frame = { id: frames.length + 1, callback, cancelled: false };
      frames.push(frame);
      return frame.id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      for (const frame of frames) {
        if (frame.id === id) frame.cancelled = true;
      }
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    registration = { mounts: [], api: null, duringMount: null };
    portals = { current: null };
    release = vi.fn<() => void>();
    dismissed = vi.fn<() => void>();
    ref = React.createRef();
    uninstall = installWebOverlayPresentationGuard(() => ({
      ready: Promise.resolve(true),
      release,
    }));
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    uninstall();
    container.remove();
    vi.unstubAllGlobals();
    sheetControls.reset();
  });
  function render(content: React.ReactNode) {
    root.render(
      <ActualProvider>
        <ProviderReceipt registration={registration} portals={portals}>
          {content}
        </ProviderReceipt>
      </ActualProvider>,
    );
  }
  function sheet() {
    return (
      <IsolatedBottomSheetModal
        ref={ref}
        name="tested"
        contextBridge={null}
        nativeBrowserOverlap
        onDismiss={dismissed}
      >
        <input autoFocus data-actual-editor />
      </IsolatedBottomSheetModal>
    );
  }
  async function pending() {
    act(() => render(sheet()));
    await act(async () => ref.current?.present());
    expect(frames).toHaveLength(1);
    expect(container.querySelector("[data-actual-sheet]")).toBeNull();
    return frames[0]!;
  }
  function expectEmpty() {
    expect(container.querySelector("[data-actual-sheet]")).toBeNull();
    expect(container.querySelector("[data-actual-editor]")).toBeNull();
    expect(Object.values(portals.current ?? {}).flat()).toHaveLength(0);
    expect(registration.api?.dismiss("tested")).toBe(false);
  }
  for (const method of ["dismiss", "close", "forceClose"] as const) {
    it(`cancels ${method} before the actual RAF and rejects a forcibly invoked cancelled callback`, async () => {
      const old = await pending();
      await act(async () => ref.current?.[method]());
      expect(old.cancelled).toBe(true);
      expect(registration.mounts).toEqual([]);
      expect(dismissed).toHaveBeenCalledOnce();
      expect(release).toHaveBeenCalledOnce();
      await act(async () => old.callback(0));
      expectEmpty();
      expect(dismissed).toHaveBeenCalledOnce();
      await act(async () => ref.current?.present());
      await act(async () => {
        frames[1]!.callback(1);
        old.callback(2);
      });
      expect(container.querySelectorAll("[data-actual-sheet]")).toHaveLength(1);
      expect(release).toHaveBeenCalledOnce();
    });
  }
  it("cancels controlled visible=false after forwarding but before RAF", async () => {
    act(() => render(<ControlledOverlapSheet visible onClose={dismissed} />));
    await act(async () => {});
    const old = frames[0]!;
    await act(async () => render(<ControlledOverlapSheet visible={false} onClose={dismissed} />));
    await act(async () => old.callback(0));
    expect(registration.mounts).toEqual([]);
    expectEmpty();
    expect(release).toHaveBeenCalledOnce();
    expect(dismissed).not.toHaveBeenCalled();
  });
  it("overrides the queued mount state after RAF registration but before React commit", async () => {
    const old = await pending();
    await act(async () => {
      old.callback(0);
      ref.current?.dismiss();
    });
    expect(registration.mounts).toEqual(["tested"]);
    expectEmpty();
    expect(dismissed).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    await act(async () => ref.current?.present());
    await act(async () => frames[1]!.callback(1));
    expect(container.querySelectorAll("[data-actual-sheet]")).toHaveLength(1);
  });
  it("rejects retained real portal publication callbacks after cancellation and a newer presentation", async () => {
    sheetControls.holdPublication = true;
    const old = await pending();
    await act(async () => old.callback(0));
    const stale = [...sheetControls.publications];
    expect(stale.length).toBeGreaterThan(0);
    expect(container.querySelector("[data-actual-sheet]")).toBeNull();
    await act(async () => ref.current?.dismiss());
    expectEmpty();
    sheetControls.holdPublication = false;
    await act(async () => ref.current?.present());
    await act(async () => frames[1]!.callback(1));
    const editor = container.querySelector("[data-actual-editor]");
    await act(async () => {
      for (const publish of stale) publish();
      old.callback(2);
    });
    expect(container.querySelectorAll("[data-actual-sheet]")).toHaveLength(1);
    expect(container.querySelector("[data-actual-editor]")).toBe(editor);
    expect(dismissed).toHaveBeenCalledOnce();
  });
  it("cancels during real provider mount and notifies only after its registration is removed", async () => {
    const old = await pending();
    registration.duringMount = () => ref.current?.dismiss();
    dismissed.mockImplementation(() => {
      expect(registration.api?.dismiss("tested")).toBe(false);
      ref.current?.present();
    });
    await act(async () => old.callback(0));
    expectEmpty();
    expect(dismissed).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    registration.duringMount = null;
    await act(async () => frames[1]!.callback(1));
    expect(container.querySelectorAll("[data-actual-sheet]")).toHaveLength(1);
  });
  it("removes a registration cancelled inside the real provider replace callback", async () => {
    const previous = React.createRef<React.ElementRef<typeof ActualModal>>();
    const incoming = React.createRef<React.ElementRef<typeof ActualModal>>();
    const previousDismissed = vi.fn(() => incoming.current?.dismiss());
    sheetControls.holdPublication = true;
    act(() =>
      render(
        <>
          <ActualModal ref={previous} name="previous" onDismiss={previousDismissed}>
            <span />
          </ActualModal>
          <ActualModal ref={incoming} name="tested" stackBehavior="replace" onDismiss={dismissed}>
            <span />
          </ActualModal>
        </>,
      ),
    );
    act(() => previous.current?.present());
    await act(async () => frames[0]!.callback(0));
    act(() => incoming.current?.present());
    await act(async () => frames[1]!.callback(1));
    expect(previousDismissed).toHaveBeenCalledOnce();
    expect(dismissed).toHaveBeenCalledOnce();
    expect(registration.api?.dismiss("previous")).toBe(false);
    expectEmpty();
    await act(async () => {
      for (const publish of sheetControls.publications) publish();
    });
    expectEmpty();
    expect(dismissed).toHaveBeenCalledOnce();
  });
  for (const afterRAF of [false, true]) {
    it(`disposes the owner ${afterRAF ? "after registration" : "before RAF"} without a late callback`, async () => {
      const old = await pending();
      await act(async () => {
        if (afterRAF) old.callback(0);
        render(null);
      });
      await act(async () => old.callback(1));
      expectEmpty();
      expect(dismissed).not.toHaveBeenCalled();
      expect(release).toHaveBeenCalledOnce();
      expect(registration.mounts).toHaveLength(afterRAF ? 1 : 0);
    });
  }
  it("does not evaluate a retained old portal element after a new generation becomes current", async () => {
    const old = await pending();
    await act(async () => old.callback(0));
    const stored = Object.values(portals.current ?? {}).flat()[0]?.node;
    expect(stored).toBeTruthy();
    act(() => ref.current?.dismiss());
    await act(async () => {
      [...sheetControls.finishCloses.values()][0]!();
    });
    await act(async () => ref.current?.present());
    await act(async () => frames[1]!.callback(1));
    const editor = container.querySelector("[data-actual-editor]");
    await act(async () =>
      render(
        <>
          {sheet()}
          <div data-obsolete-portal>{stored}</div>
        </>,
      ),
    );
    expect(container.querySelector("[data-obsolete-portal]")?.childElementCount).toBe(0);
    expect(container.querySelectorAll("[data-actual-editor]")).toHaveLength(1);
    expect(container.querySelector("[data-actual-editor]")).toBe(editor);
  });
  it("fails admission before any real RAF/provider publication and then retries with a fresh request", async () => {
    uninstall();
    let attempts = 0;
    uninstall = installWebOverlayPresentationGuard(() => ({
      ready: Promise.resolve(++attempts > 1),
      release,
    }));
    act(() => render(sheet()));
    await act(async () => ref.current?.present());
    expect(frames).toHaveLength(0);
    expect(registration.mounts).toEqual([]);
    expectEmpty();
    expect(dismissed).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    await act(async () => ref.current?.present());
    await act(async () => frames[0]!.callback(0));
    expect(container.querySelector("[data-actual-editor]")).not.toBeNull();
  });
  it("keeps the default wrapper outside native admission while using the corrected public cancellation", async () => {
    act(() =>
      render(
        <IsolatedBottomSheetModal
          ref={ref}
          name="tested"
          contextBridge={null}
          onDismiss={dismissed}
        >
          <input data-default-editor />
        </IsolatedBottomSheetModal>,
      ),
    );
    act(() => ref.current?.present());
    expect(frames).toHaveLength(1);
    await act(async () => ref.current?.dismiss());
    await act(async () => frames[0]!.callback(0));
    expectEmpty();
    expect(dismissed).toHaveBeenCalledOnce();
    expect(release).not.toHaveBeenCalled();
  });
  it("coalesces actual public pending presents to latest data and keeps normal mounted close animation", async () => {
    const raw =
      React.createRef<
        import("@gorhom/bottom-sheet/lib/typescript/types").BottomSheetModalMethods<string>
      >();
    act(() =>
      render(
        <ActualModal<string> ref={raw} name="tested" onDismiss={dismissed}>
          {({ data }: { data?: string }) => <span data-payload>{data}</span>}
        </ActualModal>,
      ),
    );
    act(() => {
      raw.current?.present("first");
      raw.current?.present("latest");
    });
    expect(frames).toHaveLength(1);
    await act(async () => {
      frames[0]!.callback(0);
      raw.current?.present("after RAF, before commit");
    });
    expect(frames).toHaveLength(1);
    expect(registration.mounts).toEqual(["tested"]);
    expect(container.querySelector("[data-payload]")?.textContent).toBe("after RAF, before commit");
    act(() => raw.current?.dismiss());
    expect(container.querySelector("[data-actual-sheet]")).not.toBeNull();
    expect(dismissed).not.toHaveBeenCalled();
    const close = [...sheetControls.finishCloses.values()][0]!;
    await act(async () => {
      close();
      close();
    });
    expectEmpty();
    expect(dismissed).toHaveBeenCalledOnce();
  });
  for (const method of ["close", "forceClose"] as const) {
    it(`preserves committed ${method} and its actual terminal callback`, async () => {
      const frame = await pending();
      await act(async () => frame.callback(0));
      const element = container.querySelector("[data-actual-sheet]");
      const id = element?.getAttribute("data-actual-sheet");
      act(() => ref.current?.[method]());
      expect(sheetControls.closes).toEqual([`${method}:${id}`]);
      expect(element?.isConnected).toBe(true);
      expect(dismissed).not.toHaveBeenCalled();
      expect(release).not.toHaveBeenCalled();
      await act(async () => {
        [...sheetControls.finishCloses.values()][0]!();
      });
      expectEmpty();
      expect(dismissed).toHaveBeenCalledOnce();
      expect(release).toHaveBeenCalledOnce();
    });
  }
  it("retains independent native leases until each actual animated sheet leaves the portal", async () => {
    const second = React.createRef<IsolatedBottomSheetModalRef>();
    act(() =>
      render(
        <>
          {sheet()}
          <IsolatedBottomSheetModal
            ref={second}
            name="second"
            contextBridge={null}
            nativeBrowserOverlap
          >
            <span data-second />
          </IsolatedBottomSheetModal>
        </>,
      ),
    );
    await act(async () => ref.current?.present());
    await act(async () => frames[0]!.callback(0));
    await act(async () => second.current?.present());
    await act(async () => frames[1]!.callback(1));
    const editor = container.querySelector("[data-actual-editor]");
    expect(document.activeElement).toBe(editor);
    act(() => ref.current?.dismiss());
    expect(release).not.toHaveBeenCalled();
    expect(editor?.isConnected).toBe(true);
    const first = [...sheetControls.finishCloses.values()][0]!;
    await act(async () => first());
    expect(release).toHaveBeenCalledOnce();
    expect(editor?.isConnected).toBe(false);
    expect(container.querySelector("[data-second]")).not.toBeNull();
    act(() => second.current?.dismiss());
    expect(release).toHaveBeenCalledOnce();
    await act(async () => {
      [...sheetControls.finishCloses.values()][0]!();
    });
    expect(release).toHaveBeenCalledTimes(2);
  });
});
