import { arrayMove } from "@dnd-kit/sortable";

export interface DragEndInput<T> {
  items: T[];
  activeId: string;
  overId: string | null | undefined;
  keyExtractor: (item: T, index: number) => string;
  getDragGroupKey?: (item: T) => string | null;
}

export function reorderItemsOnDragEnd<T>({
  items,
  activeId,
  overId,
  keyExtractor,
  getDragGroupKey,
}: DragEndInput<T>): T[] | null {
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

  return arrayMove(items, oldIndex, newIndex);
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
