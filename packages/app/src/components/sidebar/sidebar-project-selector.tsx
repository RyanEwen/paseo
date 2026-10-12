import { useIsCompactFormFactor } from "@/constants/layout";
import { useCallback, useMemo, type ReactElement } from "react";
import { Text } from "react-native";
import { ChevronDown } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useAppSettings } from "@/hooks/use-settings";
import { useHosts } from "@/runtime/host-runtime";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import { useProjectIcons } from "@/projects/icons";
import { resolveSidebarProjectIconTargets } from "@/utils/sidebar-project-row-model";
import type { Theme } from "@/styles/theme";
import {
  MenuRoot,
  MenuTrigger,
  MenuSurface,
  MenuItem,
  type MenuTriggerState,
} from "@/components/ui/menu";
import { useSidebarModel } from "./sidebar-model";
import { SidebarProjectMenuItem } from "./sidebar-project-menu-item";
import { resolveSidebarProjectLabels } from "./sidebar-project-filter";

const ThemedChevronDown = withUnistyles(ChevronDown);
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/** Restores the legacy heading when the fork's selector is disabled, without changing filters. */
export function SidebarProjectSelector(): ReactElement {
  const { settings } = useAppSettings();
  const { t } = useTranslation();
  if (!settings.paseoPlusPlus.sidebarProjectSelector) {
    return <Text style={styles.title}>{t("sidebar.projectSelector.workspaces")}</Text>;
  }
  return <ProjectSelectorMenu />;
}

/** Edits the existing allowlist; unavailable stored keys remain intact until an explicit choice. */
function ProjectSelectorMenu(): ReactElement {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const { allProjects, resolvedProjectFilters } = useSidebarModel();
  const hosts = useHosts();
  const toggleProjectFilter = useSidebarViewStore((state) => state.toggleProjectFilter);
  const clearProjectFilters = useSidebarViewStore((state) => state.clearProjectFilters);
  const labels = useMemo(
    () => resolveSidebarProjectLabels(allProjects, hosts),
    [allProjects, hosts],
  );
  const iconTargets = useMemo(() => resolveSidebarProjectIconTargets(allProjects), [allProjects]);
  const icons = useProjectIcons({ projects: iconTargets });

  const triggerStyle = useCallback(
    ({ hovered, pressed, open }: MenuTriggerState) => [
      styles.trigger,
      isCompact && styles.compactTrigger,
      (hovered || pressed || open) && styles.triggerHovered,
    ],
    [isCompact],
  );

  let label = t("sidebar.projectSelector.allWorkspaces");
  if (resolvedProjectFilters.length === 1) {
    label = t("sidebar.projectSelector.projectWorkspaces", {
      project: labels.get(resolvedProjectFilters[0]),
    });
  } else if (resolvedProjectFilters.length > 1) {
    label = t("sidebar.projectSelector.multipleWorkspaces", {
      count: resolvedProjectFilters.length,
    });
  }

  return (
    <MenuRoot compactMode="sheet">
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
        align="start"
        width={288}
        scrollable
        sheetTitle={t("sidebar.projectSelector.title")}
        testID="sidebar-project-selector-content"
      >
        <MenuItem
          selected={resolvedProjectFilters.length === 0}
          closeOnSelect={false}
          onSelect={clearProjectFilters}
          testID="sidebar-project-selector-all"
        >
          {t("sidebar.projectSelector.all")}
        </MenuItem>
        {allProjects.map((project) => (
          <SidebarProjectMenuItem
            key={project.viewKey}
            viewKey={project.viewKey}
            label={labels.get(project.viewKey) ?? project.projectName}
            iconDataUri={icons.get(project.viewKey) ?? null}
            selected={resolvedProjectFilters.includes(project.viewKey)}
            onSelect={toggleProjectFilter}
            closeOnSelect={false}
            testID={`sidebar-project-selector-${project.viewKey}`}
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
    minHeight: 28,
  },
  compactTrigger: { minHeight: 40 },
  triggerHovered: { backgroundColor: theme.colors.surfaceSidebarHover },
  title: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
}));
