import {
  getSettingsEditingBlocked,
  subscribeSettingsEditingBlocked,
} from "@/settings-sync/save-handler";
import { workspaceLabelKey } from "@getpaseo/protocol/workspace-labels";
import { useSettingsSyncState } from "@/settings-sync/bootstrap";
import { useHostFeature } from "@/runtime/host-features";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { type SidebarWorkspaceTrailing, type WorkspaceTitleSource } from "@/hooks/use-settings";
import {
  useSidebarViewStore,
  type SidebarGroupMode,
  type SidebarSortMode,
  type SidebarWorkspaceSortMode,
  type SidebarEmptyProjectSortMode,
  type SidebarProjectVisibility,
  type SidebarLabelFilter,
} from "@/stores/sidebar-view-store";
import { type SidebarChecksDisplay } from "./checks-display";
import { type SidebarRowItem, type SidebarRowItems } from "./row-items";

import {
  toggleSidebarTrailingItem,
  type SidebarTrailingChoice,
} from "../workspace-trailing/selection";

export interface SidebarDisplayPreferences {
  preferencesDisabled: boolean;
  preferencesDisabledReason: string | null;
  initialWorkspaceCount: number | null;
  setInitialWorkspaceCount: (count: number | null) => void;
  workspaceUpdatedWithinDays: number | null;
  setWorkspaceUpdatedWithinDays: (days: number | null) => void;
  workspaceSorting: SidebarWorkspaceSortMode;
  setWorkspaceSorting: (mode: SidebarWorkspaceSortMode) => void;
  sorting: SidebarSortMode;
  setSorting: (mode: SidebarSortMode) => void;
  projectVisibility: SidebarProjectVisibility;
  setProjectVisibility: (visibility: SidebarProjectVisibility) => void;
  emptyProjectSorting: SidebarEmptyProjectSortMode;
  setEmptyProjectSorting: (mode: SidebarEmptyProjectSortMode) => void;
  oneProjectAtATime: boolean;
  toggleOneProjectAtATime: () => void;
  groupEmptyProjects: boolean;
  setGroupEmptyProjects: (enabled: boolean) => void;
  toggleGroupEmptyProjects: () => void;
  showBackground: boolean;
  toggleBackground: () => void;
  grouping: SidebarGroupMode;
  setGrouping: (mode: SidebarGroupMode) => void;
  toggleGrouping: () => void;
  titleSource: WorkspaceTitleSource;
  setTitleSource: (source: WorkspaceTitleSource) => void;
  rowItems: SidebarRowItems;
  toggleRowItem: (item: SidebarRowItem) => void;
  checksDisplay: SidebarChecksDisplay;
  setChecksDisplay: (display: SidebarChecksDisplay) => void;
  trailing: SidebarWorkspaceTrailing;
  /** Each trailing item can be shown independently. */
  toggleTrailing: (choice: SidebarTrailingChoice) => void;
  hostFilters: readonly string[];
  toggleHostFilter: (serverId: string) => void;
  clearHostFilters: () => void;
  /** Raw stored selection. For anything the user sees, use the model's resolved list instead. */
  projectFilters: readonly string[];
  toggleProjectFilter: (viewKey: string) => void;
  clearProjectFilters: () => void;
  labelFilter: SidebarLabelFilter;
  toggleLabelFilter: (name: string) => void;
  clearLabelFilter: () => void;
}

/**
 * Every decision the sidebar's display-preferences menu can make, behind one interface.
 *
 * Grouping and host filters live in a local zustand store while the title source and row items
 * are synced app settings — a split that exists for good reasons (a filter is transient view
 * state; a preference follows you) and that the menu has no business knowing about. Callers ask
 * this for a value and set it; where it lands is this module's problem.
 */
export function useSidebarDisplayPreferences(): SidebarDisplayPreferences {
  const workspaceSorting = useSidebarViewStore((state) => state.workspaceSortMode);
  const sorting = useSidebarViewStore((state) => state.sortMode);
  const projectVisibility = useSidebarViewStore((state) => state.projectVisibility);
  const emptyProjectSorting = useSidebarViewStore((state) => state.emptyProjectSortMode);
  const oneProjectAtATime = useSidebarViewStore((state) => state.oneProjectAtATime);
  const groupEmptyProjects = useSidebarViewStore((state) => state.groupEmptyProjects);
  const showBackground = useSidebarViewStore((state) => state.showBackground);
  const grouping = useSidebarViewStore((state) => state.groupMode);
  const setGrouping = useSidebarViewStore((state) => state.setGroupMode);
  const toggleGrouping = useSidebarViewStore((state) => state.toggleGroupMode);
  const hostFilters = useSidebarViewStore((state) => state.hostFilters);
  const toggleHostFilter = useSidebarViewStore((state) => state.toggleHostFilter);
  const clearHostFilters = useSidebarViewStore((state) => state.clearHostFilters);
  const projectFilters = useSidebarViewStore((state) => state.projectFilters);
  const toggleProjectFilter = useSidebarViewStore((state) => state.toggleProjectFilter);
  const clearProjectFilters = useSidebarViewStore((state) => state.clearProjectFilters);
  const labelFilter = useSidebarViewStore((state) => state.labelFilter);

  const workspaceTitleSource = useSidebarViewStore((state) => state.workspaceTitleSource);
  const sidebarWorkspaceTrailing = useSidebarViewStore((state) => state.sidebarWorkspaceTrailing);
  const sidebarRowItems = useSidebarViewStore((state) => state.sidebarRowItems);
  const sidebarChecksDisplay = useSidebarViewStore((state) => state.sidebarChecksDisplay);
  const initialWorkspaceCount = useSidebarViewStore((state) => state.initialWorkspaceCount);
  const workspaceUpdatedWithinDays = useSidebarViewStore(
    (state) => state.workspaceUpdatedWithinDays,
  );
  const ready = useSidebarViewStore((state) => state.modeProfilesInitialized);
  const commit = useSidebarViewStore((state) => state.setModePreferences);
  const update = useCallback(
    (patch: Parameters<typeof commit>[0]) => commit(patch, grouping),
    [commit, grouping],
  );
  const setWorkspaceSorting = useCallback(
    (mode: SidebarWorkspaceSortMode) => update({ workspaceSortMode: mode }),
    [update],
  );
  const setSorting = useCallback((mode: SidebarSortMode) => update({ sortMode: mode }), [update]);
  const setProjectVisibility = useCallback(
    (visibility: SidebarProjectVisibility) => update({ projectVisibility: visibility }),
    [update],
  );
  const setEmptyProjectSorting = useCallback(
    (mode: SidebarEmptyProjectSortMode) => update({ emptyProjectSortMode: mode }),
    [update],
  );
  const setGroupEmptyProjects = useCallback(
    (enabled: boolean) => update({ groupEmptyProjects: enabled }),
    [update],
  );
  const toggleEmptyProjects = useSidebarViewStore((state) => state.toggleModeEmptyProjects);
  const toggleGroupEmptyProjects = useCallback(
    () => toggleEmptyProjects(grouping),
    [toggleEmptyProjects, grouping],
  );
  const toggleOneProjectAtATime = useCallback(
    () => update((current) => ({ oneProjectAtATime: !current.oneProjectAtATime })),
    [update],
  );
  const toggleBackground = useCallback(
    () => update((current) => ({ showBackground: !current.showBackground })),
    [update],
  );
  const toggleLabelFilter = useCallback(
    (name: string) =>
      update((current) => {
        const key = workspaceLabelKey(name);
        return {
          labelFilter: {
            labels: current.labelFilter.labels.includes(key)
              ? current.labelFilter.labels.filter((label) => label !== key)
              : [...current.labelFilter.labels, key],
          },
        };
      }),
    [update],
  );
  const clearLabelFilter = useCallback(() => update({ labelFilter: { labels: [] } }), [update]);
  const error = useSidebarViewStore((state) => state.preferenceError);
  const pending = useSidebarViewStore((state) => state.preferencePendingCount > 0);
  const sync = useSettingsSyncState();
  const hostSupported = useHostFeature(sync.selectedHost, "appSettingsSidebarModeProfiles");
  const unsupported = sync.selectedHost !== null && !hostSupported;
  const blocked = useSyncExternalStore(
    subscribeSettingsEditingBlocked,
    getSettingsEditingBlocked,
    getSettingsEditingBlocked,
  );
  const preferencesDisabled =
    blocked ||
    !ready ||
    unsupported ||
    !sync.canWrite ||
    !["local", "ready", "offline"].includes(sync.status);
  let preferencesDisabledReason: string | null = error;
  if (pending && !error) preferencesDisabledReason = "Saving sidebar preferences";
  if (preferencesDisabled) preferencesDisabledReason = "Load writable settings before editing";
  if (unsupported)
    preferencesDisabledReason = "Update the settings host to use separate sidebar modes";
  const setInitialWorkspaceCount = useCallback(
    (count: number | null) => update({ initialWorkspaceCount: count }),
    [update],
  );
  const setWorkspaceUpdatedWithinDays = useCallback(
    (days: number | null) => update({ workspaceUpdatedWithinDays: days }),
    [update],
  );

  const setTitleSource = useCallback(
    (source: WorkspaceTitleSource) => {
      update({ workspaceTitleSource: source });
    },
    [update],
  );

  const toggleRowItem = useCallback(
    (item: SidebarRowItem) => {
      update((current) => ({
        sidebarRowItems: { ...current.sidebarRowItems, [item]: !current.sidebarRowItems[item] },
      }));
    },
    [update],
  );

  const setChecksDisplay = useCallback(
    (display: SidebarChecksDisplay) => {
      update({ sidebarChecksDisplay: display });
    },
    [update],
  );

  const toggleTrailing = useCallback(
    (choice: SidebarTrailingChoice) => {
      update((current) => ({
        sidebarWorkspaceTrailing: toggleSidebarTrailingItem({
          trailing: current.sidebarWorkspaceTrailing,
          choice,
        }),
      }));
    },
    [update],
  );

  return useMemo(
    () => ({
      preferencesDisabled,
      preferencesDisabledReason,
      initialWorkspaceCount,
      setInitialWorkspaceCount,
      workspaceUpdatedWithinDays,
      setWorkspaceUpdatedWithinDays,
      workspaceSorting,
      setWorkspaceSorting,
      sorting,
      setSorting,
      projectVisibility,
      setProjectVisibility,
      emptyProjectSorting,
      setEmptyProjectSorting,
      oneProjectAtATime,
      toggleOneProjectAtATime,
      groupEmptyProjects,
      setGroupEmptyProjects,
      toggleGroupEmptyProjects,
      showBackground,
      toggleBackground,
      grouping,
      setGrouping,
      toggleGrouping,
      titleSource: workspaceTitleSource,
      setTitleSource,
      rowItems: sidebarRowItems,
      toggleRowItem,
      checksDisplay: sidebarChecksDisplay,
      setChecksDisplay,
      trailing: sidebarWorkspaceTrailing,
      toggleTrailing,
      hostFilters,
      toggleHostFilter,
      clearHostFilters,
      projectFilters,
      toggleProjectFilter,
      clearProjectFilters,
      labelFilter,
      toggleLabelFilter,
      clearLabelFilter,
    }),
    [
      preferencesDisabled,
      preferencesDisabledReason,
      initialWorkspaceCount,
      setInitialWorkspaceCount,
      workspaceUpdatedWithinDays,
      setWorkspaceUpdatedWithinDays,
      workspaceSorting,
      setWorkspaceSorting,
      sorting,
      setSorting,
      projectVisibility,
      setProjectVisibility,
      emptyProjectSorting,
      setEmptyProjectSorting,
      oneProjectAtATime,
      toggleOneProjectAtATime,
      groupEmptyProjects,
      setGroupEmptyProjects,
      toggleGroupEmptyProjects,
      showBackground,
      toggleBackground,
      grouping,
      setGrouping,
      toggleGrouping,
      workspaceTitleSource,
      setTitleSource,
      sidebarRowItems,
      toggleRowItem,
      sidebarChecksDisplay,
      setChecksDisplay,
      sidebarWorkspaceTrailing,
      toggleTrailing,
      hostFilters,
      toggleHostFilter,
      clearHostFilters,
      projectFilters,
      toggleProjectFilter,
      clearProjectFilters,
      labelFilter,
      toggleLabelFilter,
      clearLabelFilter,
    ],
  );
}

/**
 * Just the row items, for the row renderers. They re-render per workspace, so they subscribe to
 * the one field they use rather than to every preference in the menu.
 */
export function useSidebarRowItems(): SidebarRowItems {
  return useSidebarViewStore((state) => state.sidebarRowItems);
}

/**
 * Everything the line under a workspace title needs to know, in one read. The two settings are
 * answered together by `selectMetaRowItems`, so asking for them separately would only mean two
 * subscriptions per row for one decision.
 */
export function useSidebarMetaPreferences(): {
  rowItems: SidebarRowItems;
  checksDisplay: SidebarChecksDisplay;
} {
  const rowItems = useSidebarViewStore((state) => state.sidebarRowItems);
  const checksDisplay = useSidebarViewStore((state) => state.sidebarChecksDisplay);
  return useMemo(() => ({ rowItems, checksDisplay }), [rowItems, checksDisplay]);
}
