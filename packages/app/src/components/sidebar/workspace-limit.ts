interface SidebarWorkspaceLimitInput<T> {
  items: readonly T[];
  initialCount: number | null;
  expanded: boolean;
}

/** Apply the same initial limit to project, pinned and flattened status groups without mutating their order. */
export function limitSidebarWorkspaces<T>({
  items,
  initialCount,
  expanded,
}: SidebarWorkspaceLimitInput<T>) {
  const showAll = expanded || initialCount === null;
  const visibleItems = showAll ? items.slice() : items.slice(0, initialCount);
  const canToggle = initialCount !== null && items.length > initialCount;
  return { visibleItems, canToggle };
}

/** Validate a user-entered count without rounding, clamping or accepting partial numbers. */
export function parseSidebarWorkspaceCount(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
