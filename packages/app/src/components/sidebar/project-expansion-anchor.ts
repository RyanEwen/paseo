import { createContext, useContext, useRef } from "react";
import type { View } from "react-native";

export type AnchorProjectExpansion = (target: View, toggle: () => void) => void;
export const ProjectExpansionAnchorContext = createContext<AnchorProjectExpansion>(
  (_target, toggle) => toggle(),
);

export function useProjectExpansionAnchor() {
  const ref = useRef<View>(null);
  const anchor = useContext(ProjectExpansionAnchorContext);
  return { ref, anchor };
}

/** Nestable lists read .current as well as invoking the React callback ref. */
export function createProjectScrollRef<T>(
  register: ((node: T | null) => unknown) & { current: T | null },
) {
  let attached: T | null = null;
  const ref = (node: T | null): void => {
    attached = node;
    register(node);
  };
  Object.defineProperty(ref, "current", { get: () => attached });
  return ref as typeof ref & { readonly current: T | null };
}

export interface ProjectExpansionFollowing {
  cancel: () => void;
  dispose: () => void;
}

interface ExpansionGeometry {
  headerTop: number;
  viewportTop: number;
}

/** Follow painted coordinates: the list owns easing and may be interrupted mid-transition. */
export function anchorProjectExpansion({
  measure,
  scrollBy,
  duration,
  toggle,
  requestFrame = requestAnimationFrame,
  cancelFrame = cancelAnimationFrame,
}: {
  measure: (receive: (geometry: ExpansionGeometry | null) => void) => void;
  scrollBy: (delta: number) => void;
  duration: number;
  toggle: () => void;
  requestFrame?: typeof requestAnimationFrame;
  cancelFrame?: typeof cancelAnimationFrame;
}): ProjectExpansionFollowing {
  let cancelled = false;
  let disposed = false;
  let toggled = false;
  const commitToggle = () => {
    if (disposed || toggled) return;
    toggled = true;
    toggle();
  };
  let frame: number | undefined;
  let start: number | undefined;
  measure((initial) => {
    if (disposed) return;
    commitToggle();
    if (cancelled || !initial) return;
    const anchorTop = Math.max(0, initial.headerTop - initial.viewportTop);
    const follow = (time: number) => {
      if (cancelled) return;
      start ??= time;
      measure((geometry) => {
        if (cancelled || !geometry) return;
        const delta = geometry.headerTop - geometry.viewportTop - anchorTop;
        if (Math.abs(delta) > 0.5) scrollBy(delta);
        if (time - start! < duration) frame = requestFrame(follow);
      });
    };
    frame = requestFrame(follow);
  });
  const stopFrames = () => {
    cancelled = true;
    if (frame !== undefined) cancelFrame(frame);
  };
  return {
    cancel: () => {
      stopFrames();
      // Scrolling can be cancelled; the user's accepted expansion must still happen once.
      // Flush it before a newer click so delayed native measurements cannot reorder toggles.
      commitToggle();
    },
    dispose: () => {
      disposed = true;
      stopFrames();
    },
  };
}
