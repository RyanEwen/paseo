import { arrayMove } from "@dnd-kit/sortable";

export interface DragEndInput<T> {
  items: T[];
  activeId: string;
  overId: string | null | undefined;
  keyExtractor: (item: T, index: number) => string;
  getDragGroupKey?: (item: T) => string | null;
}

/** Actual active item and the row crossed at the drop position, before any filtering merge. */
export interface DragReorderMove {
  activeKey: string;
  overKey: string;
  from: number;
  to: number;
}

export function describeDragReorderMove<T>({
  items,
  originalItems,
  from,
  to,
  keyExtractor,
}: {
  items: T[];
  originalItems?: T[];
  from: number;
  to: number;
  keyExtractor: (item: T, index: number) => string;
}): DragReorderMove | null {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) return null;
  if (from < 0 || to < 0 || from >= items.length || to >= items.length) return null;
  // `items` is the drop result. The crossed anchor sits immediately beside the active item.
  const anchorIndex = from < to ? to - 1 : to + 1;
  const activeKey = keyExtractor(items[to]!, to);
  const overKey = keyExtractor(items[anchorIndex]!, anchorIndex);
  if (
    originalItems &&
    (originalItems.length !== items.length ||
      keyExtractor(originalItems[from]!, from) !== activeKey ||
      keyExtractor(originalItems[to]!, to) !== overKey)
  )
    return null;
  return {
    activeKey,
    overKey,
    from,
    to,
  };
}

export function reorderItemsOnDragEnd<T>(input: DragEndInput<T>): T[] | null {
  return reorderItemsWithMove(input)?.items ?? null;
}

export function reorderItemsWithMove<T>({
  items,
  activeId,
  overId,
  keyExtractor,
  getDragGroupKey,
}: DragEndInput<T>): { items: T[]; move: DragReorderMove } | null {
  if (!overId || activeId === overId) return null;

  const oldIndex = items.findIndex((item, i) => keyExtractor(item, i) === activeId);
  const newIndex = items.findIndex((item, i) => keyExtractor(item, i) === overId);

  if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return null;

  if (getDragGroupKey) {
    const group = getDragGroupKey(items[oldIndex]!);
    if (group === null) return null;
    const first = Math.min(oldIndex, newIndex);
    const last = Math.max(oldIndex, newIndex);
    if (items.slice(first, last + 1).some((item) => getDragGroupKey(item) !== group)) {
      return null;
    }
  }

  const reordered = arrayMove(items, oldIndex, newIndex);
  return {
    items: reordered,
    move: { activeKey: activeId, overKey: overId, from: oldIndex, to: newIndex },
  };
}

/** Validate native drop results before persisting: fixed cells and group boundaries stay put. */
export function isDragGroupOrderValid<T>({
  original,
  reordered,
  keyExtractor,
  getDragGroupKey,
}: {
  original: T[];
  reordered: T[];
  keyExtractor: (item: T, index: number) => string;
  getDragGroupKey: (item: T) => string | null;
}): boolean {
  if (original.length !== reordered.length) return false;
  const remaining = new Set(original.map(keyExtractor));
  for (let index = 0; index < original.length; index++) {
    const before = original[index]!;
    const after = reordered[index]!;
    const group = getDragGroupKey(before);
    if (group !== getDragGroupKey(after)) return false;
    const key = keyExtractor(after, index);
    if (!remaining.delete(key)) return false;
    if (group === null && keyExtractor(before, index) !== key) return false;
  }
  return remaining.size === 0;
}
