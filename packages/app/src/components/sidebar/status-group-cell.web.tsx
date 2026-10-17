import { useCallback, useLayoutEffect, useRef, type ReactNode } from "react";
import { View } from "react-native";

interface StatusGroupCellProps {
  workspaceKey: string;
  groupKey: string;
  resolveDestinationGroupKey: (workspaceKey: string) => string | undefined;
  children: ReactNode;
}

/** A header can be inside the window while fixed sidebar controls clip it out of the scrollport. */
function hasPaintedIntersection(header: HTMLElement): boolean {
  const bounds = header.getBoundingClientRect();
  let left = Math.max(0, bounds.left);
  let top = Math.max(0, bounds.top);
  let right = Math.min(window.innerWidth, bounds.right);
  let bottom = Math.min(window.innerHeight, bounds.bottom);

  for (let ancestor = header.parentElement; ancestor; ancestor = ancestor.parentElement) {
    const style = getComputedStyle(ancestor);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    const clip = ancestor.getBoundingClientRect();
    if (style.overflowX !== "visible") {
      left = Math.max(left, clip.left + ancestor.clientLeft);
      right = Math.min(right, clip.left + ancestor.clientLeft + ancestor.clientWidth);
    }
    if (style.overflowY !== "visible") {
      top = Math.max(top, clip.top + ancestor.clientTop);
      bottom = Math.min(bottom, clip.top + ancestor.clientTop + ancestor.clientHeight);
    }
    if (right <= left || bottom <= top) return false;
  }
  return right > left && bottom > top;
}

/** Move focus only when sorting hides the focused row; floating surfaces retain their own focus. */
export function StatusGroupCell({
  workspaceKey,
  groupKey,
  resolveDestinationGroupKey,
  children,
}: StatusGroupCellProps) {
  const nodeRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const node = nodeRef.current;
    return () => {
      if (!node || !node.contains(document.activeElement)) return;
      // Read the current destination after the commit, when headers and hidden membership agree.
      queueMicrotask(() => {
        if (node.isConnected) return;
        const key = resolveDestinationGroupKey(workspaceKey);
        if (!key) return;
        const header = document.querySelector(
          `[data-testid="sidebar-status-group-${CSS.escape(key)}"]`,
        );
        if (!(header instanceof HTMLElement) || header.tabIndex < 0) return;
        if (!hasPaintedIntersection(header) || header.closest('[aria-hidden="true"]')) return;
        const focus = document.activeElement;
        if (focus && focus !== document.body && focus !== document.documentElement) return;
        header.focus({ preventScroll: true });
      });
    };
  }, [resolveDestinationGroupKey, workspaceKey]);

  // RN web's host ref is a DOM node. Narrow it rather than casting a native View ref.
  const setNodeRef = useCallback((node: unknown) => {
    nodeRef.current = node instanceof HTMLElement ? node : null;
  }, []);
  return (
    <View ref={setNodeRef} testID={`sidebar-status-group-rows-${groupKey}`}>
      {children}
    </View>
  );
}
