import { z } from "zod";
import { DEFAULT_SIDEBAR_ROW_ITEMS } from "@/components/sidebar/display-preferences/row-items";
import type { AppSettings } from "@/hooks/use-settings/storage";

export const SidebarModePreferencesSchema = z.object({
  sortMode: z.enum(["project", "status", "custom"]),
  workspaceSortMode: z.enum(["name", "status", "custom"]),
  projectVisibility: z.enum(["all", "unarchived"]),
  groupEmptyProjects: z.boolean(),
  emptyProjectSortMode: z.enum(["project", "custom"]),
  showBackground: z.boolean(),
  labelFilter: z.object({ labels: z.array(z.string()) }),
  workspaceTitleSource: z.enum(["title", "branch"]),
  sidebarRowItems: z.object({
    project: z.boolean(),
    branch: z.boolean(),
    host: z.boolean(),
    changeRequest: z.boolean(),
    services: z.boolean(),
    labels: z.boolean(),
  }),
  sidebarChecksDisplay: z.enum(["iconAndText", "icon", "none"]),
  sidebarWorkspaceTrailing: z.enum(["diff", "timestamp", "both", "none"]),
  initialWorkspaceCount: z.number().int().positive().nullable(),
  workspaceUpdatedWithinDays: z.number().int().positive().nullable(),
});
export type SidebarModePreferences = z.infer<typeof SidebarModePreferencesSchema>;
export const SidebarModeProfilesSchema = z.object({
  project: SidebarModePreferencesSchema,
  status: SidebarModePreferencesSchema,
});
export type SidebarModeProfiles = z.infer<typeof SidebarModeProfilesSchema>;
export const SidebarLocalFiltersSchema = z.object({
  hostFilters: z.array(z.string()),
  projectFilters: z.array(z.string()),
});
export const SidebarLocalModeFiltersSchema = z.object({
  project: SidebarLocalFiltersSchema,
  status: SidebarLocalFiltersSchema,
});
export type SidebarLocalModeFilters = z.infer<typeof SidebarLocalModeFiltersSchema>;

export function defaultSidebarModePreferences(mode: "project" | "status"): SidebarModePreferences {
  return {
    sortMode: mode === "status" ? "status" : "custom",
    workspaceSortMode: mode === "status" ? "status" : "custom",
    projectVisibility: mode === "status" ? "unarchived" : "all",
    groupEmptyProjects: true,
    emptyProjectSortMode: "custom",
    showBackground: false,
    labelFilter: { labels: [] },
    workspaceTitleSource: "title",
    sidebarRowItems: { ...DEFAULT_SIDEBAR_ROW_ITEMS },
    sidebarChecksDisplay: "iconAndText",
    sidebarWorkspaceTrailing: "timestamp",
    initialWorkspaceCount: 20,
    workspaceUpdatedWithinDays: null,
  };
}
export function defaultSidebarModeProfiles(): SidebarModeProfiles {
  return {
    project: defaultSidebarModePreferences("project"),
    status: defaultSidebarModePreferences("status"),
  };
}
export function defaultSidebarLocalModeFilters(): SidebarLocalModeFilters {
  return {
    project: { hostFilters: [], projectFilters: [] },
    status: { hostFilters: [], projectFilters: [] },
  };
}

/** COMPAT(sidebarModeProfiles): preserve the active legacy view once; remove after 2027-10-16. */
export function legacySidebarPresentation(
  settings: AppSettings,
): Pick<
  SidebarModePreferences,
  | "workspaceTitleSource"
  | "sidebarRowItems"
  | "sidebarChecksDisplay"
  | "sidebarWorkspaceTrailing"
  | "initialWorkspaceCount"
> {
  return {
    workspaceTitleSource: settings.workspaceTitleSource,
    sidebarRowItems: settings.sidebarRowItems,
    sidebarChecksDisplay: settings.sidebarChecksDisplay,
    sidebarWorkspaceTrailing: settings.sidebarWorkspaceTrailing,
    initialWorkspaceCount: settings.sidebarInitialWorkspaceCount,
  };
}

/** Compatibility export for explicit initialization of a host that only stores the legacy view. */
export function exportLegacySidebarPresentation(profile: SidebarModePreferences) {
  return {
    workspaceTitleSource: profile.workspaceTitleSource,
    sidebarRowItems: profile.sidebarRowItems,
    sidebarChecksDisplay: profile.sidebarChecksDisplay,
    sidebarWorkspaceTrailing: profile.sidebarWorkspaceTrailing,
    sidebarInitialWorkspaceCount: profile.initialWorkspaceCount,
  };
}
