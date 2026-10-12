import { useCallback, useMemo, useState } from "react";

export const SIDEBAR_INITIAL_VISIBLE_ITEMS = 20;

export function useLimitedSidebarGroup<T>(items: readonly T[]) {
  const [expanded, setExpanded] = useState(false);
  const visibleItems = useMemo(
    () => (expanded ? items.slice() : items.slice(0, SIDEBAR_INITIAL_VISIBLE_ITEMS)),
    [expanded, items],
  );
  const canToggle = items.length > SIDEBAR_INITIAL_VISIBLE_ITEMS;
  const toggleExpanded = useCallback(() => setExpanded((current) => !current), []);

  return { visibleItems, expanded, canToggle, toggleExpanded };
}
