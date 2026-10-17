import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import type { SidebarWorkspaceGroup } from "./sidebar-labels";
import { limitSidebarWorkspaces } from "./workspace-limit";

export type StatusListItem =
  | { kind: "header"; group: SidebarWorkspaceGroup; collapsed: boolean }
  | { kind: "workspace"; workspace: SidebarWorkspaceEntry; groupKey: string }
  | { kind: "footer"; groupKey: string; expanded: boolean; canToggle: boolean };

/** Keep workspace keys independent of their status group so moves retain their React subtree. */
export function statusListItemKey(item: StatusListItem): string {
  if (item.kind === "header") return `header:${item.group.key}`;
  if (item.kind === "footer") return `footer:${item.groupKey}`;
  return `workspace:${item.workspace.workspaceKey}`;
}

/** Structural entries never initiate a drag or become an allowed drop target. */
export function statusListDragGroupKey(item: StatusListItem): string | null {
  return item.kind === "workspace" ? item.groupKey : null;
}

/** Flatten visible groups under one cell owner without changing collapse or limit policy. */
export function buildStatusListItems({
  groups,
  collapsedGroupKeys,
  expandedGroupKeys,
  initialCount,
  updatedWithin,
}: {
  groups: SidebarWorkspaceGroup[];
  collapsedGroupKeys: ReadonlySet<string>;
  expandedGroupKeys: ReadonlySet<string>;
  initialCount: number | null;
  updatedWithin?: { days: number; now: number };
}): StatusListItem[] {
  const result: StatusListItem[] = [];
  for (const group of groups) {
    const collapsed = collapsedGroupKeys.has(group.key);
    result.push({ kind: "header", group, collapsed });
    if (collapsed) continue;
    const expanded = expandedGroupKeys.has(group.key);
    const { visibleItems, canToggle } = limitSidebarWorkspaces({
      items: group.rows,
      initialCount,
      expanded,
      updatedWithin: updatedWithin
        ? { ...updatedWithin, getStatusEnteredAt: (workspace) => workspace.statusEnteredAt }
        : undefined,
    });
    for (const workspace of visibleItems) {
      result.push({ kind: "workspace", workspace, groupKey: group.key });
    }
    result.push({
      kind: "footer",
      groupKey: group.key,
      expanded,
      canToggle,
    });
  }
  return result;
}
