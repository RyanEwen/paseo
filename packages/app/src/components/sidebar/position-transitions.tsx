import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { AccessibilityInfo } from "react-native";
import { useAppSettings } from "@/hooks/use-settings";
import { useRetainedPanelActive } from "@/components/retained-panel";

const PositionTransitionDurationContext = createContext(0);

/** Read the shared policy without installing another accessibility subscription per row. */
export function useSidebarPositionTransitionDuration(): number {
  return useContext(PositionTransitionDurationContext);
}

/** Share the sidebar's quick motion policy, including live accessibility changes. */
export function SidebarPositionTransitions({ children }: { children: ReactNode }) {
  const { settings, isLoading } = useAppSettings();
  const active = useRetainedPanelActive();
  // Start without motion until the platform has answered its accessibility query.
  const [reducedMotion, setReducedMotion] = useState(true);

  useEffect(() => {
    let current = true;
    let changed = false;
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (reduced) => {
      changed = true;
      setReducedMotion(reduced);
    });
    async function readPreference() {
      const reduced = await AccessibilityInfo.isReduceMotionEnabled();
      if (current && !changed) setReducedMotion(reduced);
    }
    void readPreference();
    return () => {
      current = false;
      subscription.remove();
    };
  }, []);

  const enabled =
    active && !isLoading && !reducedMotion && settings.paseoPlusPlus.sidebarWorkspaceTransitions;
  return (
    <PositionTransitionDurationContext value={enabled ? 100 : 0}>
      {children}
    </PositionTransitionDurationContext>
  );
}
