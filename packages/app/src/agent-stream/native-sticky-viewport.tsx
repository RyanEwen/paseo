import { createContext, useContext, useEffect, type ReactNode, type RefObject } from "react";
import type { SharedValue } from "react-native-reanimated";
export interface NativeStickyViewport {
  y: SharedValue<number>;
}
const Context = createContext<NativeStickyViewport | null>(null);
export function NativeStickyViewportProvider({
  value,
  children,
}: {
  value: NativeStickyViewport;
  children: ReactNode;
}) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useNativeStickyViewport() {
  const value = useContext(Context);
  if (!value) throw new Error("Sticky cell requires its viewport scroll driver");
  return value;
}

/** Endpoint publication, not keyboard frames, invalidates/re-measures this reader. */
export function useNativeReadingRefresh(
  snapshot: import("@/keyboard/shift/internal/policy").DockReservationSnapshot,
  refresh: () => void,
  invalidate: () => void,
  measurementOwner?: NativeMeasurementContextValue,
) {
  useEffect(() => {
    refresh();
    return invalidate;
  }, [snapshot.extent, snapshot.settledRevision, refresh, invalidate, measurementOwner]);
}

export interface NativeMeasurementContextValue {
  mode: "docked" | "standalone";
  stationaryViewportRef: RefObject<import("react-native").View | null> | null;
}
export const NativeMeasurementContext = createContext<NativeMeasurementContextValue | null>(null);
export function useNativeMeasurementContext() {
  const value = useContext(NativeMeasurementContext);
  if (!value) throw new Error("Native transcript requires its declared motion boundary");
  return value;
}
