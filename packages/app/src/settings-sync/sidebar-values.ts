import { isSettingsObject } from "@getpaseo/protocol/app-settings-values";
import {
  legacySidebarPresentation,
  SidebarModePreferencesSchema,
} from "@/stores/sidebar-mode-preferences";
import { normalizeSidebarModeState, projectSidebarMode } from "@/stores/sidebar-view-store";
import type { AppSettings } from "@/hooks/use-settings/storage";

/** Wire documents preserve unknown leaves; the strict local storage envelope has a different owner. */
export function normalizeRemoteSidebarModes(value: unknown, legacyApp: AppSettings) {
  const raw = isSettingsObject(value) ? value : {};
  const known: Record<string, unknown> = {};
  for (const key of [
    "groupMode",
    "sortMode",
    "workspaceSortMode",
    "projectVisibility",
    "groupEmptyProjects",
    "emptyProjectSortMode",
    "showBackground",
    "labelFilter",
  ] as const) {
    if (key in raw) known[key] = raw[key];
  }
  const state = normalizeSidebarModeState(known);
  state.modeProfiles[state.groupMode] = {
    ...state.modeProfiles[state.groupMode],
    ...legacySidebarPresentation(legacyApp),
  };
  if (isSettingsObject(raw.modeProfiles)) {
    for (const mode of ["project", "status"] as const) {
      const parsed = SidebarModePreferencesSchema.safeParse(raw.modeProfiles[mode]);
      if (parsed.success) state.modeProfiles[mode] = parsed.data;
    }
  }
  return projectSidebarMode(state);
}
