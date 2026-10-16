import {
  createElement,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { isWeb } from "@/constants/platform";
import {
  getWebOverlayPresentationVersion,
  hasWebOverlayPresentationGuard,
  requestWebOverlayPresentation,
  subscribeWebOverlayPresentationGuard,
  type WebOverlayPresentation,
} from "./overlay-presentation";

/** React/Reanimated may retain a closing surface after its owner unmounts.
 * Observe the actual nodes rather than guessing the animation duration. */
function releaseAfterRemoval(lease: WebOverlayPresentation, nodes: Set<HTMLElement>): void {
  queueMicrotask(() => {
    const connected = () => [...nodes].some((node) => node.isConnected);
    if (!connected()) {
      lease.release();
      return;
    }
    const observer = new window.MutationObserver(() => {
      if (connected()) return;
      observer.disconnect();
      lease.release();
    });
    observer.observe(document, { childList: true, subtree: true });
    if (!connected()) {
      observer.disconnect();
      lease.release();
    }
  });
}

interface PresentationState {
  session: object;
  version: number;
  ready: boolean;
}

/** Explicit blocking-surface opt-in. The caller keeps its existing inner keyboard
 * scope, but mounts no modal/backdrop/autofocus children before ready. */
export function useWebOverlayPresentationLifetime({
  active,
  nativeBrowserOverlap = false,
  identity,
  onAdmissionFailed,
}: {
  active: boolean;
  nativeBrowserOverlap?: boolean;
  identity?: unknown;
  onAdmissionFailed(): void;
}) {
  const version = useSyncExternalStore(
    subscribeWebOverlayPresentationGuard,
    getWebOverlayPresentationVersion,
    getWebOverlayPresentationVersion,
  );
  const session = useMemo(() => ({ active, identity }), [active, identity]);
  const currentSession = useRef(session);
  currentSession.current = session;
  const failed = useRef(onAdmissionFailed);
  failed.current = onAdmissionFailed;
  const nodes = useRef(new Map<object, Set<HTMLElement>>());
  const [state, setState] = useState<PresentationState | null>(null);
  const required = isWeb && nativeBrowserOverlap && hasWebOverlayPresentationGuard();

  const retainNode = useCallback(
    (node: unknown) => {
      if (!isWeb || !(node instanceof HTMLElement)) return;
      const owned = nodes.current.get(session) ?? new Set<HTMLElement>();
      owned.add(node);
      nodes.current.set(session, owned);
    },
    [session],
  );

  useLayoutEffect(() => {
    if (!active || !isWeb || !nativeBrowserOverlap) return;
    const ownedNodes = nodes.current;
    let live = true;
    let lease: WebOverlayPresentation | null = null;
    let attempt = 0;
    const retire = (previous: WebOverlayPresentation | null) => {
      if (previous) releaseAfterRemoval(previous, ownedNodes.get(session) ?? new Set());
    };
    const acquire = () => {
      const epoch = ++attempt;
      const admittedVersion = getWebOverlayPresentationVersion();
      setState({ session, version: admittedVersion, ready: false });
      const previous = lease;
      try {
        lease = requestWebOverlayPresentation();
      } catch {
        lease = null;
        retire(previous);
        if (live && currentSession.current === session) failed.current();
        return;
      }
      retire(previous);
      const current = lease;
      const finish = (ready: boolean) => {
        if (!live || epoch !== attempt || currentSession.current !== session) return;
        if (!ready) {
          failed.current();
          return;
        }
        setState({ session, version: admittedVersion, ready: true });
      };
      if (!current) finish(true);
      else void current.ready.then(finish, () => finish(false));
    };
    acquire();
    // Acquisition happens synchronously during late installation, before the
    // first native page's create IPC can overtake an already-open modal.
    const unsubscribe = subscribeWebOverlayPresentationGuard(acquire);
    return () => {
      live = false;
      unsubscribe();
      retire(lease);
      ownedNodes.delete(session);
    };
  }, [active, nativeBrowserOverlap, session]);

  return {
    ready:
      !active ||
      !required ||
      (state !== null && state.session === session && state.version === version && state.ready),
    retainNode,
  };
}

/** Reanimated web exiting moves real children to a retained clone. This hidden
 * node moves with them, so the same lease follows actual removal, not ref detach. */
export function WebOverlayLifetimeMarker({ retainNode }: { retainNode(node: unknown): void }) {
  return isWeb
    ? createElement("span", { hidden: true, "aria-hidden": true, ref: retainNode })
    : null;
}
