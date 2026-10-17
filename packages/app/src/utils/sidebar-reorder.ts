import type { SidebarViewStoreState } from "@/stores/sidebar-view-store";
import type { DragReorderMove } from "@/components/drag-reorder/reorder-items";

export function mergeWithRemainder(input: {
  currentOrder: string[];
  reorderedVisibleKeys: string[];
}): string[] {
  const reorderedSet = new Set(input.reorderedVisibleKeys);
  const remainder = input.currentOrder.filter((key) => !reorderedSet.has(key));
  return [...input.reorderedVisibleKeys, ...remainder];
}

export function hasVisibleOrderChanged(input: {
  currentOrder: string[];
  reorderedVisibleKeys: string[];
}): boolean {
  const visibleSet = new Set(input.reorderedVisibleKeys);
  const currentVisible = input.currentOrder.filter((key) => visibleSet.has(key));
  if (currentVisible.length !== input.reorderedVisibleKeys.length) {
    return true;
  }
  return input.reorderedVisibleKeys.some((key, index) => currentVisible[index] !== key);
}

/**
 * Separate project pin drags from ordinary ordering. Return no ordinary update when only pins
 * moved, preserving both the selected sort mode and hidden siblings' saved positions.
 */
export function resolveProjectWorkspaceReorder(input: {
  currentVisibleKeys: string[];
  reorderedVisibleKeys: string[];
  projectPinnedKeys: ReadonlySet<string>;
  storedWorkspaceOrder: string[];
}): { projectPinKeys: string[]; workspaceOrder: string[] | null } {
  const ordinaryKeys = input.reorderedVisibleKeys.filter(
    (key) => !input.projectPinnedKeys.has(key),
  );
  const ordinaryOrderChanged = hasVisibleOrderChanged({
    currentOrder: input.currentVisibleKeys.filter((key) => !input.projectPinnedKeys.has(key)),
    reorderedVisibleKeys: ordinaryKeys,
  });
  return {
    projectPinKeys: input.reorderedVisibleKeys.filter((key) => input.projectPinnedKeys.has(key)),
    workspaceOrder: ordinaryOrderChanged
      ? mergeWithRemainder({
          currentOrder: input.storedWorkspaceOrder,
          reorderedVisibleKeys: ordinaryKeys,
        })
      : null,
  };
}

/** Move only the dragged project relative to its actual anchor; all other siblings stay ordered. */
export function moveProjectInFullOrder({
  currentOrder,
  knownProjectKeys,
  move,
}: {
  currentOrder: readonly string[];
  knownProjectKeys: readonly string[];
  move: DragReorderMove;
}): string[] | null {
  if (move.from === move.to || move.activeKey === move.overKey) return null;
  const order = [...new Set([...currentOrder, ...knownProjectKeys])];
  if (!order.includes(move.activeKey) || !order.includes(move.overKey)) return null;
  const remaining = order.filter((key) => key !== move.activeKey);
  const anchorIndex = remaining.indexOf(move.overKey);
  remaining.splice(anchorIndex + (move.from < move.to ? 1 : 0), 0, move.activeKey);
  return remaining;
}

export type SidebarReorderDomain = "project" | "workspace";
type SidebarReorderView = Pick<
  SidebarViewStoreState,
  | "groupMode"
  | "sortMode"
  | "emptyProjectSortMode"
  | "workspaceSortMode"
  | "hostFilters"
  | "projectFilters"
  | "labelFilter"
  | "showBackground"
  | "projectVisibility"
  | "groupEmptyProjects"
>;

export function sidebarReorderSort(view: SidebarReorderView, domain: SidebarReorderDomain): string {
  if (domain === "workspace") return view.workspaceSortMode;
  return view.groupMode === "project" ? view.sortMode : view.emptyProjectSortMode;
}

/** The rendered domain must still own a drop; cached directory additions are not a filter change. */
export function sidebarReorderContext(
  view: SidebarReorderView,
  domain: SidebarReorderDomain,
  quickFilterText = "",
): string {
  return JSON.stringify([
    view.groupMode,
    quickFilterText.trim().toLowerCase(),
    sidebarReorderSort(view, domain),
    view.hostFilters,
    view.projectFilters,
    view.labelFilter,
    view.showBackground,
    view.projectVisibility,
    view.groupEmptyProjects,
  ]);
}

export function canCommitSidebarReorder(input: {
  startedContext: string | null;
  currentContext: string;
  sort: string;
  manualPins?: boolean;
}): boolean {
  return (
    input.startedContext !== null &&
    input.startedContext === input.currentContext &&
    (input.manualPins === true || input.sort === "custom")
  );
}
