import { useCallback } from "react";
import { DraggableList } from "@/components/draggable-list";
import type { DraggableListProps } from "@/components/draggable-list.types";
import { useSidebarReorderGuard } from "@/hooks/use-sidebar-reorder-guard";

/** Manual pins retain their own order while sharing the sidebar's gesture context. */
export function SidebarPinnedList<T>({
  onDragEnd,
  ...props
}: Omit<DraggableListProps<T>, "onDragBegin">) {
  const { onDragBegin, canCommit } = useSidebarReorderGuard("workspace");
  const handleDragEnd = useCallback<DraggableListProps<T>["onDragEnd"]>(
    (items, move) => {
      if (canCommit(true)) onDragEnd(items, move);
    },
    [canCommit, onDragEnd],
  );
  return <DraggableList {...props} onDragBegin={onDragBegin} onDragEnd={handleDragEnd} />;
}
