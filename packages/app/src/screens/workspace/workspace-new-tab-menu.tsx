import { useTranslation } from "react-i18next";
import { PanelRightOpen } from "lucide-react-native";
import { MenuSubTrigger, useMenuContext, type MenuPageDefinition } from "@/components/ui/menu";
import { SplitLayoutPicker } from "@/components/split-layout-picker";
import type { SplitSide } from "@/components/split-layout-presets";
import { useSettings } from "@/hooks/use-settings";
import { useCallback, useMemo, type ComponentType, type ReactElement } from "react";
import { View } from "react-native";
import { withUnistyles } from "react-native-unistyles";
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Shortcut } from "@/components/ui/shortcut";
import { TerminalProfileIcon } from "@/components/terminal-profile-icon";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import type { Theme } from "@/styles/theme";
import {
  useWorkspaceTabLaunchCatalog,
  useWorkspaceTabSplitLaunchEnabled,
  type WorkspaceTabLaunchItem,
  type WorkspaceTabLaunchPurpose,
} from "@/workspace-tabs/launcher";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import type { PaneHost } from "@/panels/panel-manifest";
import type { PanelIconProps } from "@/panels/panel-registry";

const ThemedPanelRightOpen = withUnistyles(PanelRightOpen);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const SPLIT_LAUNCH_ICON = <ThemedPanelRightOpen size={16} uniProps={mutedColorMapping} />;

function LaunchItemIconGlyph({
  Icon,
  color = "",
}: {
  Icon: ComponentType<PanelIconProps>;
  color?: string;
}) {
  return <Icon size={14} color={color} />;
}

const ThemedLaunchItemIconGlyph = withUnistyles(LaunchItemIconGlyph);

function LaunchItemIcon({ item }: { item: WorkspaceTabLaunchItem }): ReactElement | null {
  if (item.Icon) {
    return <ThemedLaunchItemIconGlyph Icon={item.Icon} uniProps={mutedColorMapping} />;
  }
  if (item.terminalIconKey) {
    return (
      <View>
        <TerminalProfileIcon iconKey={item.terminalIconKey} size={14} />
      </View>
    );
  }
  return null;
}

/** Render a catalog action consistently in tab-strip and compact workspace menus. */
export function WorkspaceNewTabMenuItem({
  item,
  paneId,
  splitPageId,
}: {
  item: WorkspaceTabLaunchItem;
  paneId?: string;
  splitPageId?: string;
}) {
  const { t } = useTranslation();
  const leading = useMemo(() => <LaunchItemIcon item={item} />, [item]);
  const trailing = useMemo(
    () =>
      item.shortcutActionId ? <LaunchItemShortcut actionId={item.shortcutActionId} /> : undefined,
    [item.shortcutActionId],
  );
  const splitAction = useMemo(
    () =>
      splitPageId ? (
        <MenuSubTrigger
          id={splitPageId}
          iconOnly
          accessibilityLabel={t("workspace.splits.openToSide", { item: item.label })}
          leading={SPLIT_LAUNCH_ICON}
          disabled={item.disabled}
          testID={splitPageId}
        />
      ) : undefined,
    [splitPageId, item.label, item.disabled, t],
  );
  const handleSelect = useCallback(() => item.launch({ kind: "open", paneId }), [item, paneId]);

  return (
    <DropdownMenuItem
      testID={`workspace-new-tab-menu-${item.id}`}
      leading={leading}
      trailing={trailing}
      secondaryAction={splitAction}
      disabled={item.disabled}
      onSelect={handleSelect}
    >
      {item.label}
    </DropdownMenuItem>
  );
}

function LaunchItemShortcut({ actionId }: { actionId: string }) {
  const keys = useShortcutKeys(actionId);
  return keys ? <Shortcut chord={keys} /> : null;
}

export function WorkspaceNewTabMenuContent({
  serverId,
  purpose,
  host,
  panePanelKinds,
  paneId,
}: {
  serverId: string;
  purpose: WorkspaceTabLaunchPurpose;
  host: PaneHost;
  panePanelKinds: readonly WorkspaceTabTarget["kind"][];
  paneId?: string;
}) {
  const groups = useWorkspaceTabLaunchCatalog({
    serverId,
    purpose,
    host,
    surface: "menu",
    panePanelKinds,
  });

  const featureEnabled = useSettings((settings) => settings.paseoPlusPlus.splitLayoutPresets);
  const scopeEnabled = useWorkspaceTabSplitLaunchEnabled();
  const canSplit = featureEnabled && scopeEnabled && host === "main";
  const { t } = useTranslation();
  const pages = useMemo<MenuPageDefinition[]>(
    () =>
      canSplit
        ? groups.flatMap((group) =>
            group.items
              .filter((item) => item.id !== "reopen-closed-agent")
              .map((item) => ({
                id: `workspace-new-tab-split-${item.id}`,
                title: t("workspace.splits.openToSide", { item: item.label }),
                hoverIntent: false,
                content: <LaunchSplitPicker item={item} paneId={paneId} />,
              })),
          )
        : [],
    [canSplit, groups, paneId, t],
  );
  return (
    <DropdownMenuContent
      side="bottom"
      align="start"
      offset={4}
      minWidth={canSplit ? 300 : 200}
      pages={pages}
      testID="workspace-new-tab-menu"
    >
      {groups.map((group, index) => (
        <View key={group.id}>
          {index > 0 ? <DropdownMenuSeparator /> : null}
          {group.label ? <DropdownMenuLabel>{group.label}</DropdownMenuLabel> : null}
          {group.items.map((item) => (
            <WorkspaceNewTabMenuItem
              key={item.id}
              item={item}
              paneId={paneId}
              splitPageId={
                canSplit && item.id !== "reopen-closed-agent"
                  ? `workspace-new-tab-split-${item.id}`
                  : undefined
              }
            />
          ))}
          {group.accessory ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                testID={`workspace-new-tab-menu-${group.accessory.id}`}
                onSelect={group.accessory.run}
              >
                {group.accessory.label}
              </DropdownMenuItem>
            </>
          ) : null}
        </View>
      ))}
    </DropdownMenuContent>
  );
}

/** Keep normal row activation separate from creating the selected view in a new split. */
function LaunchSplitPicker({ item, paneId }: { item: WorkspaceTabLaunchItem; paneId?: string }) {
  const menu = useMenuContext("LaunchSplitPicker");
  const select = useCallback(
    (position: SplitSide, firstPaneFraction: number) => {
      menu.selectItem(
        () => item.launch({ kind: "split", paneId, position, firstPaneFraction }),
        true,
      );
    },
    [item, menu, paneId],
  );
  return (
    <SplitLayoutPicker
      onSelect={select}
      disabled={item.disabled}
      testIDPrefix={`workspace-new-tab-layout-${item.id}`}
    />
  );
}
