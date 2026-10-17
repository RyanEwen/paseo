interface SidebarWorkspaceLimitInput<T> {
  items: readonly T[];
  initialCount: number | null;
  expanded: boolean;
  updatedWithin?: {
    days: number;
    now: number;
    getStatusEnteredAt: (item: T) => Date | null;
  };
}

/** Apply the same initial limit to project, pinned and flattened status groups without mutating their order. */
export function limitSidebarWorkspaces<T>({
  items,
  initialCount,
  expanded,
  updatedWithin,
}: SidebarWorkspaceLimitInput<T>) {
  // Unknown status dates cannot establish recency; Show more always makes those rows reachable.
  const cutoff = updatedWithin ? updatedWithin.now - updatedWithin.days * 86_400_000 : 0;
  const recentItems = updatedWithin
    ? items.filter((item) => {
        const time = updatedWithin.getStatusEnteredAt(item)?.getTime();
        return time !== undefined && Number.isFinite(time) && time >= cutoff;
      })
    : items;
  const limitedItems = initialCount === null ? recentItems : recentItems.slice(0, initialCount);
  const visibleItems = expanded ? items.slice() : limitedItems.slice();
  const canToggle = limitedItems.length < items.length;
  return { visibleItems, canToggle };
}

/** Validate a user-entered count without rounding, clamping or accepting partial numbers. */
export function parseSidebarWorkspaceCount(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
