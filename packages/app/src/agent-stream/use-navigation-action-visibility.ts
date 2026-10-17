import { useEffect, useRef, useState } from "react";
import { isWeb } from "@/constants/platform";
import { useStableEvent } from "@/hooks/use-stable-event";

interface Visibility {
  epoch: string | null;
  key: string;
}

/** Hold arrow destination actions independently of hover until real mouse movement or cancellation.
 * Coordinate comparison ignores stationary pointer events caused by layout changes. Scroll input
 * clears ownership, while programmatic smooth scrolling leaves it intact. All DOM listeners are
 * web-only and belong to this mounted chat owner, including retained-pane epoch changes.
 */
export function useNavigationActionVisibility(enabled: boolean, epoch: string | null) {
  const [visibility, setVisibility] = useState<Visibility | null>(null);
  const point = useRef<{ x: number; y: number } | null>(null);
  const clear = useStableEvent(() => setVisibility(null));
  const start = useStableEvent((key: string) => {
    if (isWeb && enabled) setVisibility({ epoch, key });
  });
  // Discovery may resolve after the pointer moved. Never restore an already cleared hold.
  const retarget = useStableEvent((key: string) => {
    setVisibility((current) => (current?.epoch === epoch ? { epoch, key } : null));
  });

  useEffect(() => {
    clear();
    point.current = null;
    if (!isWeb || !enabled) return;

    function recordMouseDown(event: PointerEvent) {
      // A navigation press must retain its own hit target through pointerup/click.
      // The resulting arrow action replaces ownership; real movement clears it.
      if (event.pointerType === "mouse") point.current = { x: event.clientX, y: event.clientY };
    }
    function mouseMoved(event: PointerEvent) {
      if (event.pointerType !== "mouse") return;
      const previous = point.current;
      point.current = { x: event.clientX, y: event.clientY };
      if (!previous || previous.x !== event.clientX || previous.y !== event.clientY) clear();
    }
    document.addEventListener("pointerdown", recordMouseDown, true);
    document.addEventListener("pointermove", mouseMoved, true);
    document.addEventListener("wheel", clear, { passive: true, capture: true });
    document.addEventListener("touchstart", clear, { passive: true, capture: true });
    document.addEventListener("keydown", clear, true);
    window.addEventListener("blur", clear);
    return () => {
      document.removeEventListener("pointerdown", recordMouseDown, true);
      document.removeEventListener("pointermove", mouseMoved, true);
      document.removeEventListener("wheel", clear, true);
      document.removeEventListener("touchstart", clear, true);
      document.removeEventListener("keydown", clear, true);
      window.removeEventListener("blur", clear);
    };
  }, [enabled, epoch, clear]);

  return {
    key: enabled && visibility?.epoch === epoch ? visibility.key : null,
    start,
    retarget,
    clear,
  };
}
