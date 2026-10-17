import { useCallback, useMemo, type ReactElement } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { MenuItem, MenuSubTrigger } from "@/components/ui/menu";
import { HostStatusDot } from "@/components/host-status-dot";
import type { useHosts } from "@/runtime/host-runtime";

export function HostFilterPage({
  preferences,
  hosts,
  projectPageIds,
}: {
  preferences: {
    hostFilters: readonly string[];
    clearHostFilters(): void;
    toggleHostFilter(serverId: string): void;
  };
  hosts: ReturnType<typeof useHosts>;
  projectPageIds?: ReadonlyMap<string, string>;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <>
      <MenuItem
        selected={preferences.hostFilters.length === 0}
        closeOnSelect={false}
        onSelect={preferences.clearHostFilters}
        testID="sidebar-host-filter-all"
      >
        {t("sidebar.display.hostFilter.all")}
      </MenuItem>
      {hosts.map((host) =>
        projectPageIds?.has(host.serverId) ? (
          <HostProjectPageTrigger
            key={host.serverId}
            serverId={host.serverId}
            pageId={projectPageIds.get(host.serverId)!}
            label={host.label?.trim() || host.serverId}
            selected={preferences.hostFilters.includes(host.serverId)}
          />
        ) : (
          <HostFilterItem
            key={host.serverId}
            serverId={host.serverId}
            label={host.label?.trim() || host.serverId}
            selected={preferences.hostFilters.includes(host.serverId)}
            onToggle={preferences.toggleHostFilter}
          />
        ),
      )}
    </>
  );
}

/** The one option row whose mark is live state rather than an icon. */
export function HostFilterItem({
  serverId,
  label,
  selected,
  onToggle,
}: {
  serverId: string;
  label: string;
  selected: boolean;
  onToggle: (serverId: string) => void;
}): ReactElement {
  const handleSelect = useCallback(() => onToggle(serverId), [onToggle, serverId]);
  const leading = useMemo(
    () => (
      <View testID={`sidebar-host-filter-status-${serverId}`}>
        <HostStatusDot serverId={serverId} />
      </View>
    ),
    [serverId],
  );

  return (
    <MenuItem
      selected={selected}
      closeOnSelect={false}
      leading={leading}
      onSelect={handleSelect}
      testID={`sidebar-host-filter-${serverId}`}
    >
      {label}
    </MenuItem>
  );
}

function HostProjectPageTrigger({
  serverId,
  pageId,
  label,
  selected,
}: {
  serverId: string;
  pageId: string;
  label: string;
  selected: boolean;
}) {
  const leading = useMemo(() => <HostStatusDot serverId={serverId} />, [serverId]);
  return (
    <MenuSubTrigger
      id={pageId}
      leading={leading}
      indicator={selected}
      testID={`sidebar-chooser-host-${serverId}`}
    >
      {label}
    </MenuSubTrigger>
  );
}
