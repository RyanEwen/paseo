import { useCallback } from "react";
import { useSidebarModel } from "./sidebar-model";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import { useSidebarCollapsedSectionsStore } from "@/stores/sidebar-collapsed-sections-store";

/** Share filtered, persisted bulk transitions between desktop controls and the compact menu. */
export function useSidebarBulkCollapse() {
  const { workspaceGroups, pinnedGroups } = useSidebarModel();
  const grouping = useSidebarViewStore((state) => state.groupMode);
  const groupEmptyProjects = useSidebarViewStore((state) => state.groupEmptyProjects);
  const setSectionsCollapsed = useSidebarCollapsedSectionsStore(
    (state) => state.setSectionsCollapsed,
  );
  const setAllCollapsed = useCallback(
    (collapsed: boolean) => {
      const renderedProjects = pinnedGroups.unpinnedProjects.filter(
        (project) => grouping === "project" || project.workspaces.length === 0,
      );
      const workspaceGroupKeys =
        grouping === "status" ? workspaceGroups.map((group) => group.key) : [];
      if (
        groupEmptyProjects &&
        renderedProjects.some((project) => project.workspaces.length === 0)
      ) {
        workspaceGroupKeys.push("no-unarchived-workspaces");
      }
      setSectionsCollapsed(
        {
          projectKeys: renderedProjects.map((project) => project.viewKey),
          workspaceGroupKeys,
          includePinned: pinnedGroups.pinnedChats.length > 0,
        },
        collapsed,
      );
    },
    [pinnedGroups, workspaceGroups, grouping, groupEmptyProjects, setSectionsCollapsed],
  );
  const expandAll = useCallback(() => setAllCollapsed(false), [setAllCollapsed]);
  const collapseAll = useCallback(() => setAllCollapsed(true), [setAllCollapsed]);
  return { expandAll, collapseAll };
}
