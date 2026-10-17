import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Text } from "react-native";
import { ChevronDown } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import { CONTROL_HEIGHTS } from "@/components/ui/control-geometry";
import { useAppSettings } from "@/hooks/use-settings";
import { useHosts } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { createWorkspaceStructureProjectsSelector } from "@/stores/session-store-hooks/selectors";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import { useProjectIcons } from "@/projects/icons";
import { resolveSidebarProjectIconTargets } from "@/utils/sidebar-project-row-model";
import type { SidebarProjectEntry } from "@/hooks/use-sidebar-workspaces-list";
import type { Theme } from "@/styles/theme";
import {
  MenuRoot,
  MenuTrigger,
  MenuSurface,
  MenuItem,
  MenuSubTrigger,
  MenuSeparator,
  type MenuPageDefinition,
  type MenuTriggerState,
} from "@/components/ui/menu";
import { useSidebarProjectActivity } from "./use-sidebar-project-activity";
import { HostFilterPage } from "./sidebar-host-filter";
import { useSidebarModel } from "./sidebar-model";
import { SidebarProjectMenuItem } from "./sidebar-project-menu-item";
import { resolveSidebarProjectLabels } from "./sidebar-project-filter";

const ThemedChevronDown = withUnistyles(ChevronDown);
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/** The essential chooser remains available when its richer heading is disabled. */
export function SidebarProjectSelector(): ReactElement {
  const { t } = useTranslation();
  const compact = useIsCompactFormFactor();
  const { settings } = useAppSettings();
  const hosts = useHosts();
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const selectCatalog = useMemo(
    () => createWorkspaceStructureProjectsSelector(serverIds),
    [serverIds],
  );
  const catalog = useSessionStore(selectCatalog);
  // This is cached registry metadata, independent of either local allowlist. No directory demand here.
  const projects = useMemo<SidebarProjectEntry[]>(
    () => catalog.map((project) => ({ ...project, workspaces: [] })),
    [catalog],
  );
  const { resolvedProjectFilters, allProjects, allWorkspaceEntriesByKey } = useSidebarModel();
  const activity = useSidebarProjectActivity(allProjects, allWorkspaceEntriesByKey);
  const hostFilters = useSidebarViewStore((state) => state.hostFilters);
  const projectFilters = useSidebarViewStore((state) => state.projectFilters);
  const toggleHostFilter = useSidebarViewStore((state) => state.toggleHostFilter);
  const clearHostFilters = useSidebarViewStore((state) => state.clearHostFilters);
  const updateLocalFilters = useSidebarViewStore((state) => state.updateLocalFilters);
  const clearAll = useCallback(
    () => updateLocalFilters(() => ({ hostFilters: [], projectFilters: [] })),
    [updateLocalFilters],
  );
  const visibleProjects = projects.filter(
    (project) =>
      hostFilters.length === 0 || project.hosts.some((host) => hostFilters.includes(host.serverId)),
  );
  const selectProject = useCallback(
    (viewKey: string) =>
      updateLocalFilters((current) => ({ ...current, projectFilters: [viewKey] })),
    [updateLocalFilters],
  );
  const toggleProject = useCallback(
    (viewKey: string) =>
      updateLocalFilters((current) => ({
        ...current,
        projectFilters: current.projectFilters.includes(viewKey)
          ? current.projectFilters.filter((key) => key !== viewKey)
          : [...current.projectFilters, viewKey],
      })),
    [updateLocalFilters],
  );
  const hostPreferences = useMemo(
    () => ({ hostFilters, toggleHostFilter, clearHostFilters }),
    [hostFilters, toggleHostFilter, clearHostFilters],
  );
  const labels = useMemo(() => resolveSidebarProjectLabels(projects, hosts), [projects, hosts]);
  const [open, setOpen] = useState(false);
  const iconTargets = useMemo(
    () => (open ? resolveSidebarProjectIconTargets(projects) : []),
    [open, projects],
  );
  const icons = useProjectIcons({ projects: iconTargets });
  const pages: MenuPageDefinition[] = [
    {
      id: "hostFilter",
      title: t("sidebar.display.hostFilter.label"),
      content: <HostFilterPage preferences={hostPreferences} hosts={hosts} />,
    },
  ];
  let label = t("sidebar.projectSelector.allWorkspaces");
  if (resolvedProjectFilters.length === 1)
    label = t("sidebar.projectSelector.projectWorkspaces", {
      project: labels.get(resolvedProjectFilters[0]),
    });
  else if (resolvedProjectFilters.length > 1)
    label = t("sidebar.projectSelector.multipleWorkspaces", {
      count: resolvedProjectFilters.length,
    });
  if (!settings.paseoPlusPlus.sidebarProjectSelector)
    label = t("sidebar.projectSelector.workspaces");
  const triggerStyle = useCallback(
    ({ hovered, pressed, open: active }: MenuTriggerState) => [
      styles.trigger,
      (isNative || compact) && styles.touchTrigger,
      (hovered || pressed || active) && styles.triggerHovered,
    ],
    [compact],
  );
  return (
    <MenuRoot compactMode="sheet" open={open} onOpenChange={setOpen}>
      <MenuTrigger
        testID="sidebar-project-selector"
        accessibilityRole="button"
        accessibilityLabel={label}
        style={triggerStyle}
      >
        <Text numberOfLines={1} style={styles.title}>
          {label}
        </Text>
        <ThemedChevronDown size={14} uniProps={mutedMapping} />
      </MenuTrigger>
      <MenuSurface
        pages={pages}
        align="start"
        width={288}
        scrollable
        sheetTitle={t("sidebar.projectSelector.title")}
        testID="sidebar-project-selector-content"
      >
        {hosts.length > 1 ? (
          <>
            <MenuSubTrigger
              id="hostFilter"
              indicator={hostFilters.length > 0 || projectFilters.length > 0}
              testID="sidebar-chooser-hosts"
            >
              {t("sidebar.display.hostFilter.label")}
            </MenuSubTrigger>
            <MenuSeparator />
          </>
        ) : null}
        <MenuItem
          selected={
            resolvedProjectFilters.length === 0 &&
            (hostFilters.length === 0 || !hosts.some((host) => hostFilters.includes(host.serverId)))
          }
          onSelect={clearAll}
          testID="sidebar-project-selector-all"
        >
          {t("sidebar.projectSelector.allWorkspaces")}
        </MenuItem>
        <MenuSeparator />
        {visibleProjects.map((project) => (
          <SidebarProjectMenuItem
            key={project.viewKey}
            viewKey={project.viewKey}
            label={labels.get(project.viewKey) ?? project.projectName}
            iconDataUri={icons.get(project.viewKey) ?? null}
            selected={projectFilters.includes(project.viewKey)}
            activity={
              settings.paseoPlusPlus.sidebarActivityChips
                ? activity.get(project.viewKey)
                : undefined
            }
            onSelect={selectProject}
            onToggle={toggleProject}
            testID={`sidebar-project-selector-root-${project.viewKey}`}
          />
        ))}
      </MenuSurface>
    </MenuRoot>
  );
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 1,
    gap: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    minHeight: CONTROL_HEIGHTS.tight,
  },
  touchTrigger: { minHeight: CONTROL_HEIGHTS.field },
  triggerHovered: { backgroundColor: theme.colors.surfaceSidebarHover },
  title: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
}));
