import { createContext, useContext } from "react";
import type { DockReservationSnapshot } from "./policy";
export const DockReservationContext = createContext<DockReservationSnapshot>({
  extent: 0,
  settledRevision: 0,
});
export const useDockReservation = () => useContext(DockReservationContext);
