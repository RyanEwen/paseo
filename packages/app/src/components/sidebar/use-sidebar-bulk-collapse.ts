import { resolveSidebarCollapseTargets } from "./sidebar-projection";
import { useCallback } from "react";
import { useSidebarModel } from "./sidebar-model";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import { useSidebarCollapsedSectionsStore } from "@/stores/sidebar-collapsed-sections-store";

/** Share filtered, persisted bulk transitions between desktop controls and the compact menu. */
export function useSidebarBulkCollapse() {
  const { projects, workspaceGroups, pinnedGroups } = useSidebarModel();
  const grouping = useSidebarViewStore((state) => state.groupMode);
  const groupEmptyProjects = useSidebarViewStore((state) => state.groupEmptyProjects);
  const setSectionsCollapsed = useSidebarCollapsedSectionsStore(
    (state) => state.setSectionsCollapsed,
  );
  const setAllCollapsed = useCallback(
    (collapsed: boolean) => {
      setSectionsCollapsed(
        resolveSidebarCollapseTargets({
          projects,
          workspaceGroups,
          pinnedGroups,
          groupMode: grouping,
          groupEmptyProjects,
        }),
        collapsed,
      );
    },
    [projects, pinnedGroups, workspaceGroups, grouping, groupEmptyProjects, setSectionsCollapsed],
  );
  const expandAll = useCallback(() => setAllCollapsed(false), [setAllCollapsed]);
  const collapseAll = useCallback(() => setAllCollapsed(true), [setAllCollapsed]);
  return { expandAll, collapseAll };
}
