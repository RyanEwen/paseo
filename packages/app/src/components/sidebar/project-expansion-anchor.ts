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
}): () => void {
  let cancelled = false;
  let frame: number | undefined;
  let start: number | undefined;
  measure((initial) => {
    if (cancelled) return;
    toggle();
    if (!initial) return;
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
  return () => {
    cancelled = true;
    if (frame !== undefined) cancelFrame(frame);
  };
}
