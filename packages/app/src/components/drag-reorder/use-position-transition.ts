import { useLayoutEffect, useRef } from "react";

/** Skip first layout, membership hydration, and the reorder already owned by a user drag. */
export function usePositionTransitionDuration({
  duration,
  keys,
  dragging,
}: {
  duration: number;
  keys: string[];
  dragging: boolean;
}): number {
  const membership = JSON.stringify([...keys].sort());
  const previous = useRef({ membership: "", dragging: false });
  const stable = previous.current.membership === membership;
  const dragOwnsMotion = dragging || previous.current.dragging;

  useLayoutEffect(() => {
    previous.current = { membership, dragging };
  });

  return stable && !dragOwnsMotion ? duration : 0;
}
