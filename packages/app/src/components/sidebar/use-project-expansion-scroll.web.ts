import { useCallback, useEffect, useRef } from "react";
import type { ScrollView, View } from "react-native";
import { anchorProjectExpansion, type ProjectExpansionFollowing } from "./project-expansion-anchor";

export function useProjectExpansionScroll(duration: number) {
  const ref = useRef<ScrollView>(null);
  const stop = useRef<ProjectExpansionFollowing | null>(null);
  const cancel = useCallback(() => {
    stop.current?.cancel();
    stop.current = null;
  }, []);
  const anchor = useCallback(
    (target: View, toggle: () => void) => {
      cancel();
      const viewport: unknown = ref.current?.getScrollableNode();
      const header = target as unknown as HTMLElement;
      if (!(viewport instanceof HTMLElement)) {
        toggle();
        return;
      }
      stop.current = anchorProjectExpansion({
        duration,
        toggle,
        measure: (receive) => {
          if (!header.isConnected || header.getClientRects().length === 0) {
            receive(null);
            return;
          }
          receive({
            headerTop: header.getBoundingClientRect().top,
            viewportTop: viewport.getBoundingClientRect().top + viewport.clientTop,
          });
        },
        scrollBy: (delta) => {
          viewport.scrollTop += delta;
        },
      });
    },
    [cancel, duration],
  );
  useEffect(() => cancel(), [cancel, duration]);
  useEffect(() => {
    const viewport: unknown = ref.current?.getScrollableNode();
    if (!(viewport instanceof HTMLElement)) return;
    const events = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    for (const event of events) viewport.addEventListener(event, cancel, { passive: true });
    return () => {
      stop.current?.dispose();
      stop.current = null;
      for (const event of events) viewport.removeEventListener(event, cancel);
    };
  }, [cancel]);
  return { ref, anchor, cancel };
}
