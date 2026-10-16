import { useCallback, useEffect, useRef } from "react";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import {
  canCommitSidebarReorder,
  sidebarReorderContext,
  sidebarReorderSort,
  type SidebarReorderDomain,
} from "@/utils/sidebar-reorder";

/** Reject a stale drop even if its sort/filter changes away and then back during the gesture. */
export function useSidebarReorderGuard(domain: SidebarReorderDomain) {
  const context = useSidebarViewStore((state) => sidebarReorderContext(state, domain));
  const sort = useSidebarViewStore((state) => sidebarReorderSort(state, domain));
  const started = useRef<string | null>(null);
  useEffect(
    () =>
      useSidebarViewStore.subscribe((state) => {
        if (started.current !== sidebarReorderContext(state, domain)) started.current = null;
      }),
    [domain],
  );
  const onDragBegin = useCallback(() => {
    const current = sidebarReorderContext(useSidebarViewStore.getState(), domain);
    started.current = context === current ? context : null;
  }, [context, domain]);
  const canCommit = useCallback(
    (manualPins = false) => {
      const current = useSidebarViewStore.getState();
      return canCommitSidebarReorder({
        startedContext: started.current,
        currentContext: sidebarReorderContext(current, domain),
        sort: sidebarReorderSort(current, domain),
        manualPins,
      });
    },
    [domain],
  );
  return { disabled: sort !== "custom", onDragBegin, canCommit };
}
