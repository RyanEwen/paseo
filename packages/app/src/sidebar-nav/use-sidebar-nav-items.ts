import {
  getSettingsEditingBlocked,
  subscribeSettingsEditingBlocked,
} from "@/settings-sync/save-handler";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useAppSettings } from "@/hooks/use-settings";
import type { AppSettings } from "@/hooks/use-settings/storage";
import { useInstalledPlugins } from "@/plugins/registry";
import { groupPluginSidebarItems } from "@/plugins/sidebar-groups";
import {
  moveSidebarNavItem,
  resolveSidebarNavItems,
  setSidebarNavItemVisible,
  type SidebarNavItem,
  type SidebarSection,
} from "./model";

const PREFERENCE_FIELDS = {
  header: "sidebarNavItems",
  footer: "sidebarFooterItems",
} as const satisfies Record<SidebarSection, keyof AppSettings>;

export interface UseSidebarNavItemsReturn<Section extends SidebarSection> {
  /** Every item in the section in display order, hidden ones included. */
  items: SidebarNavItem<Section>[];
  disabled: boolean;
  setVisible: (key: string, visible: boolean) => void;
  move: (key: string, direction: "up" | "down") => void;
}

export function useSidebarNavItems<Section extends SidebarSection>(
  section: Section,
): UseSidebarNavItemsReturn<Section> {
  const syncBlocked = useSyncExternalStore(
    subscribeSettingsEditingBlocked,
    getSettingsEditingBlocked,
    getSettingsEditingBlocked,
  );
  const plugins = useInstalledPlugins();
  const { settings, updateSettings, isLoading, error } = useAppSettings();
  const field = PREFERENCE_FIELDS[section];
  const preferences = settings[field];
  const pluginGroups = useMemo(() => groupPluginSidebarItems(plugins, section), [plugins, section]);

  const items = useMemo(
    () => resolveSidebarNavItems({ section, pluginGroups, preferences }),
    [pluginGroups, preferences, section],
  );

  const setVisible = useCallback(
    (key: string, visible: boolean) => {
      void updateSettings((current) => {
        const previous = current[field];
        const currentItems = resolveSidebarNavItems({
          section,
          pluginGroups,
          preferences: previous,
        });
        return {
          [field]: setSidebarNavItemVisible({ items: currentItems, key, visible, previous }),
        };
      });
    },
    [field, pluginGroups, section, updateSettings],
  );

  const move = useCallback(
    (key: string, direction: "up" | "down") => {
      void updateSettings((current) => {
        const previous = current[field];
        const currentItems = resolveSidebarNavItems({
          section,
          pluginGroups,
          preferences: previous,
        });
        return {
          [field]: moveSidebarNavItem({ items: currentItems, key, direction, previous }),
        };
      });
    },
    [field, pluginGroups, section, updateSettings],
  );

  return { items, setVisible, move, disabled: isLoading || syncBlocked || error !== null };
}
