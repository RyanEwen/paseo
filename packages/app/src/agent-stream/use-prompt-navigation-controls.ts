import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import type { useStickyPrompt } from "./use-sticky-prompt";

type PromptNavigation = ReturnType<typeof useStickyPrompt>;
export interface PromptNavigationControls {
  targetIds: readonly (string | undefined)[];
  busy: boolean;
  previousKnownBoundary: boolean;
  activate: PromptNavigation["activate"];
}

/** Keep streamed assistant text out of the context consumed by every original prompt's buttons. */
export function usePromptNavigationControls(
  navigation: PromptNavigation,
): PromptNavigationControls {
  const selectIds = useShallow((targets: PromptNavigation["targets"]) =>
    targets.map((target) => target.item?.id),
  );
  const targetIds = selectIds(navigation.targets);
  const { busy, previousKnownBoundary, activate } = navigation;
  return useMemo(
    () => ({ targetIds, busy, previousKnownBoundary, activate }),
    [targetIds, busy, previousKnownBoundary, activate],
  );
}
