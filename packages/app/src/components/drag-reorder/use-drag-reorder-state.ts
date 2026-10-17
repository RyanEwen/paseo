import { useCallback, useReducer } from "react";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { dragStateInitial, dragStateReducer } from "./drag-reducer";
import { reorderItemsWithMove, type DragReorderMove } from "./reorder-items";

export interface DragReorderHandlers {
  onDragStart: (event: DragStartEvent) => void;
  onDragCancel: () => void;
  onDragEnd: (event: DragEndEvent) => void;
}

export interface DragReorderState<T> {
  activeId: string | null;
  items: T[];
  handlers: DragReorderHandlers;
}

export function useDragReorderState<T>({
  data,
  keyExtractor,
  onDragEnd,
  onDragBegin,
  getDragGroupKey,
  disabled = false,
}: {
  data: T[];
  keyExtractor: (item: T, index: number) => string;
  onDragEnd?: (items: T[], move?: DragReorderMove) => void;
  onDragBegin?: () => void;
  getDragGroupKey?: (item: T) => string | null;
  disabled?: boolean;
}): DragReorderState<T> {
  const [state, dispatch] = useReducer(dragStateReducer<T>, undefined, dragStateInitial<T>);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      if (disabled) return;
      dispatch({ type: "start", id: String(event.active.id), data });
      onDragBegin?.();
    },
    [data, disabled, onDragBegin],
  );

  const clearDragState = useCallback(() => {
    dispatch({ type: "clear" });
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      const items = state.dragItems ?? data;
      dispatch({ type: "clear" });
      if (disabled) return;

      const reordered = reorderItemsWithMove({
        items,
        activeId: String(active.id),
        overId: over ? String(over.id) : null,
        keyExtractor,
        getDragGroupKey,
      });
      if (reordered) onDragEnd?.(reordered.items, reordered.move);
    },
    [data, disabled, getDragGroupKey, keyExtractor, onDragEnd, state.dragItems],
  );

  return {
    activeId: state.activeId,
    items: state.dragItems ?? data,
    handlers: {
      onDragStart: handleDragStart,
      onDragCancel: clearDragState,
      onDragEnd: handleDragEnd,
    },
  };
}
