import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ScrollView, View } from "react-native";
import { useAnimatedRef, useScrollOffset } from "react-native-reanimated";
import {
  anchorProjectExpansion,
  type ProjectExpansionFollowing,
  createProjectScrollRef,
} from "./project-expansion-anchor";

export function useProjectExpansionScroll(duration: number) {
  const animatedRef = useAnimatedRef<ScrollView>();
  const ref = useMemo(() => createProjectScrollRef(animatedRef), [animatedRef]);
  // NestableScrollContainer owns onScroll; subscribe to its native tag without replacing it.
  const offset = useScrollOffset(animatedRef);
  const stop = useRef<ProjectExpansionFollowing | null>(null);
  const cancel = useCallback(() => {
    stop.current?.cancel();
    stop.current = null;
  }, []);
  useEffect(() => cancel(), [cancel, duration]);
  useEffect(
    () => () => {
      stop.current?.dispose();
      stop.current = null;
    },
    [],
  );
  const anchor = useCallback(
    (target: View, toggle: () => void) => {
      cancel();
      const viewport = animatedRef.current;
      const nativeViewport = viewport?.getNativeScrollRef();
      if (!viewport || !nativeViewport) {
        toggle();
        return;
      }
      stop.current = anchorProjectExpansion({
        duration,
        toggle,
        measure: (receive) => {
          target.measureInWindow((_x, headerTop, width) => {
            if (width === 0) {
              receive(null);
              return;
            }
            nativeViewport.measureInWindow((_vx, viewportTop) =>
              receive({ headerTop, viewportTop }),
            );
          });
        },
        scrollBy: (delta) =>
          viewport.scrollTo({ y: Math.max(0, offset.value + delta), animated: false }),
      });
    },
    [animatedRef, cancel, duration, offset],
  );
  return { ref, anchor, cancel };
}
