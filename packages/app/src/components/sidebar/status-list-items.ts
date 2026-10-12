import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import type { SidebarWorkspaceGroup } from "./sidebar-labels";
import { SIDEBAR_INITIAL_VISIBLE_ITEMS } from "./use-limited-sidebar-group";

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
}: {
  groups: SidebarWorkspaceGroup[];
  collapsedGroupKeys: ReadonlySet<string>;
  expandedGroupKeys: ReadonlySet<string>;
}): StatusListItem[] {
  const result: StatusListItem[] = [];
  for (const group of groups) {
    const collapsed = collapsedGroupKeys.has(group.key);
    result.push({ kind: "header", group, collapsed });
    if (collapsed) continue;
    const expanded = expandedGroupKeys.has(group.key);
    const visible = expanded ? group.rows : group.rows.slice(0, SIDEBAR_INITIAL_VISIBLE_ITEMS);
    for (const workspace of visible) {
      result.push({ kind: "workspace", workspace, groupKey: group.key });
    }
    result.push({
      kind: "footer",
      groupKey: group.key,
      expanded,
      canToggle: group.rows.length > SIDEBAR_INITIAL_VISIBLE_ITEMS,
    });
  }
  return result;
}
