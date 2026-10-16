import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { isWeb } from "@/constants/platform";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";

const SidebarRecencyClock = createContext(0);

/** One clock for the visible sidebar; changing the cutoff never remounts workspace rows. */
export function SidebarRecencyClockProvider({
  active,
  children,
}: {
  active?: boolean;
  children: ReactNode;
}) {
  const days = useSidebarViewStore((state) => state.workspaceUpdatedWithinDays);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (active === false || days === null) return;
    const refresh = () => setNow(Date.now());
    refresh();
    let timer: ReturnType<typeof setInterval> | undefined;
    const visible = () => {
      if (isWeb) return document.visibilityState !== "hidden";
      return AppState.currentState === "active";
    };
    const update = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      if (visible()) {
        refresh();
        timer = setInterval(refresh, 60_000);
      }
    };
    const subscription = AppState.addEventListener("change", update);
    if (isWeb) document.addEventListener("visibilitychange", update);
    update();
    return () => {
      if (timer !== undefined) clearInterval(timer);
      subscription.remove();
      if (isWeb) document.removeEventListener("visibilitychange", update);
    };
  }, [active, days]);
  return <SidebarRecencyClock.Provider value={now}>{children}</SidebarRecencyClock.Provider>;
}
export function useSidebarRecencyClock() {
  return useContext(SidebarRecencyClock);
}
