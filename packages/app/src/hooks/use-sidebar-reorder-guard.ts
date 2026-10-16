import { useSidebarQuickFilterStore } from "@/stores/sidebar-quick-filter-store";
import { useCallback, useEffect, useRef } from "react";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import {
  canCommitSidebarReorder,
  sidebarReorderContext,
  sidebarReorderSort,
  type SidebarReorderDomain,
} from "@/utils/sidebar-reorder";

function currentReorderContext(domain: SidebarReorderDomain): string {
  const view = useSidebarViewStore.getState();
  return sidebarReorderContext(
    view,
    domain,
    useSidebarQuickFilterStore.getState().byMode[view.groupMode].text,
  );
}

/** Reject a stale drop even if its sort/filter changes away and then back during the gesture. */
export function useSidebarReorderGuard(domain: SidebarReorderDomain) {
  const mode = useSidebarViewStore((state) => state.groupMode);
  const text = useSidebarQuickFilterStore((state) => state.byMode[mode].text);
  const context = useSidebarViewStore((state) => sidebarReorderContext(state, domain, text));
  const sort = useSidebarViewStore((state) => sidebarReorderSort(state, domain));
  const started = useRef<string | null>(null);
  useEffect(() => {
    const invalidate = () => {
      if (started.current !== currentReorderContext(domain)) started.current = null;
    };
    const stopView = useSidebarViewStore.subscribe(invalidate);
    const stopText = useSidebarQuickFilterStore.subscribe(invalidate);
    return () => {
      stopView();
      stopText();
    };
  }, [domain]);
  const onDragBegin = useCallback(() => {
    const current = currentReorderContext(domain);
    started.current = context === current ? context : null;
  }, [context, domain]);
  const canCommit = useCallback(
    (manualPins = false) => {
      const current = useSidebarViewStore.getState();
      return canCommitSidebarReorder({
        startedContext: started.current,
        currentContext: currentReorderContext(domain),
        sort: sidebarReorderSort(current, domain),
        manualPins,
      });
    },
    [domain],
  );
  return { disabled: sort !== "custom", onDragBegin, canCommit };
}
