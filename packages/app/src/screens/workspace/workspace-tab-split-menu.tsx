import { SplitLayoutPicker } from "@/components/split-layout-picker";
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  MenuItem,
  MenuSubTrigger,
  useMenuContext,
  type MenuPageDefinition,
} from "@/components/ui/menu";
import {
  collectAllPanes,
  findPaneContainingTab,
  type SplitNode,
} from "@/stores/workspace-layout-actions";
import { useSettings } from "@/hooks/use-settings";
import { type SplitSide } from "@/components/split-layout-presets";

interface SplitMenuOwner {
  root: SplitNode | null;
  enabled: boolean;
  onMove: (tabId: string, paneId: string) => void;
  onSplit: (input: {
    tabId: string;
    targetPaneId: string;
    position: SplitSide;
    firstPaneFraction?: number;
  }) => void;
}
const SplitMenuContext = createContext<SplitMenuOwner | null>(null);
const MOVE_INTENT = { kind: "move" } as const;

/** Keep tab movement bound to the pane tree that owns the menu, including portalled menus. */
export function WorkspaceSplitMenuScope({
  children,
  root,
  enabled,
  onMove,
  onSplit,
}: SplitMenuOwner & { children: ReactNode }) {
  const { settings } = useSettings();
  const value = useMemo(
    () => ({
      root,
      onMove,
      onSplit,
      enabled: enabled && settings.paseoPlusPlus.splitLayoutPresets,
    }),
    [root, onMove, onSplit, enabled, settings.paseoPlusPlus.splitLayoutPresets],
  );
  return <SplitMenuContext.Provider value={value}>{children}</SplitMenuContext.Provider>;
}

export interface WorkspaceTabSplitMenu {
  trigger: ReactNode;
  pages: MenuPageDefinition[];
}

/** Move the same tab to an existing pane or a new side split; content and close lifecycles stay untouched. */
export function useWorkspaceTabSplitMenu(tabId: string): WorkspaceTabSplitMenu {
  const owner = useContext(SplitMenuContext);
  const { t } = useTranslation();
  return useMemo(() => {
    const empty = { trigger: null, pages: [] };
    if (!owner?.enabled || !owner.root) return empty;
    const source = findPaneContainingTab(owner.root, tabId);
    if (!source || source.hidden) return empty;
    const panes = collectAllPanes(owner.root).filter((pane) => !pane.hidden);
    const id = `workspace-tab-move-${tabId}`;
    const pages: MenuPageDefinition[] = [
      {
        id,
        title: t("workspace.splits.moveTab"),
        hoverIntent: false,
        content: (
          <>
            {panes.map((pane, index) =>
              pane.id !== source.id ? (
                <MovePaneMenuItem
                  key={pane.id}
                  owner={owner}
                  tabId={tabId}
                  paneId={pane.id}
                  label={t("workspace.splits.pane", { index: index + 1 })}
                  menuId={id}
                />
              ) : null,
            )}
            <MoveSplitPicker owner={owner} tabId={tabId} targetPaneId={source.id} menuId={id} />
          </>
        ),
      },
    ];
    return {
      trigger: (
        <MenuSubTrigger id={id} testID={id}>
          {t("workspace.splits.moveTab")}
        </MenuSubTrigger>
      ),
      pages,
    };
  }, [owner, tabId, t]);
}

function MoveSplitPicker({
  owner,
  tabId,
  targetPaneId,
  menuId,
}: {
  owner: SplitMenuOwner;
  tabId: string;
  targetPaneId: string;
  menuId: string;
}) {
  const menu = useMenuContext("MoveSplitPicker");
  const select = useCallback(
    (position: SplitSide, firstPaneFraction: number) =>
      menu.selectItem(
        () => owner.onSplit({ tabId, targetPaneId, position, firstPaneFraction }),
        true,
      ),
    [owner, tabId, targetPaneId, menu],
  );
  return <SplitLayoutPicker intent={MOVE_INTENT} onSelect={select} testIDPrefix={menuId} />;
}

function MovePaneMenuItem({
  owner,
  tabId,
  paneId,
  label,
  menuId,
}: {
  owner: SplitMenuOwner;
  tabId: string;
  paneId: string;
  label: string;
  menuId: string;
}) {
  const select = useCallback(() => owner.onMove(tabId, paneId), [owner, tabId, paneId]);
  return (
    <MenuItem testID={`${menuId}-pane-${paneId}`} onSelect={select}>
      {label}
    </MenuItem>
  );
}
