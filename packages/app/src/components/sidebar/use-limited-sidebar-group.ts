import { useCallback, useMemo, useState } from "react";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import { useSidebarRecencyClock } from "./workspace-recency-clock";
import { limitSidebarWorkspaces } from "./workspace-limit";

export function useLimitedSidebarGroup<T>(
  items: readonly T[],
  getStatusEnteredAt: (item: T) => Date | null,
) {
  const mode = useSidebarViewStore((state) => state.groupMode);
  const [expandedModes, setExpandedModes] = useState({ project: false, status: false });
  const expanded = expandedModes[mode];
  const initialCount = useSidebarViewStore((state) => state.initialWorkspaceCount);
  const days = useSidebarViewStore((state) => state.workspaceUpdatedWithinDays);
  const now = useSidebarRecencyClock();
  const { visibleItems, canToggle } = useMemo(
    () =>
      limitSidebarWorkspaces({
        items,
        initialCount,
        expanded,
        updatedWithin: days === null ? undefined : { days, now, getStatusEnteredAt },
      }),
    [expanded, items, initialCount, days, now, getStatusEnteredAt],
  );
  const toggleExpanded = useCallback(
    () => setExpandedModes((current) => ({ ...current, [mode]: !current[mode] })),
    [mode],
  );

  return { visibleItems, expanded, canToggle, toggleExpanded };
}
