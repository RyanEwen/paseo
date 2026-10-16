import { create } from "zustand";
import type { SidebarGroupMode } from "./sidebar-view-store";

interface SidebarQuickFilterState {
  byMode: Record<SidebarGroupMode, { open: boolean; text: string }>;
  toggle: (mode: SidebarGroupMode) => void;
  close: (mode: SidebarGroupMode) => void;
  setText: (mode: SidebarGroupMode, text: string) => void;
}

/** Device-session-only text. No persist middleware or settings synchronization. */
export const useSidebarQuickFilterStore = create<SidebarQuickFilterState>((set) => ({
  byMode: { project: { open: false, text: "" }, status: { open: false, text: "" } },
  toggle: (mode) =>
    set((state) => ({
      byMode: {
        ...state.byMode,
        [mode]: { open: !state.byMode[mode].open, text: "" },
      },
    })),
  close: (mode) =>
    set((state) => ({
      byMode: {
        ...state.byMode,
        [mode]: { open: false, text: "" },
      },
    })),
  setText: (mode, text) =>
    set((state) => {
      const current = state.byMode[mode];
      // A late native editor event after close cannot leave an invisible filter active.
      if (!current.open) return state;
      return { byMode: { ...state.byMode, [mode]: { ...current, text } } };
    }),
}));
