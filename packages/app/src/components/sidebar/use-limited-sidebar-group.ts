import { useCallback, useMemo, useState } from "react";
import { useAppSettings } from "@/hooks/use-settings";
import { limitSidebarWorkspaces } from "./workspace-limit";

export function useLimitedSidebarGroup<T>(items: readonly T[]) {
  const [expanded, setExpanded] = useState(false);
  const { settings } = useAppSettings();
  const initialCount = settings.sidebarInitialWorkspaceCount;
  const { visibleItems, canToggle } = useMemo(
    () => limitSidebarWorkspaces({ items, initialCount, expanded }),
    [expanded, items, initialCount],
  );
  const toggleExpanded = useCallback(() => setExpanded((current) => !current), []);

  return { visibleItems, expanded, canToggle, toggleExpanded };
}
