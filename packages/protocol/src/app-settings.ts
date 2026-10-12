import { z } from "zod";

/** One touched preference leaf; expectedRevision detects concurrent edits to that leaf. */
export const AppSettingsPatchSchema = z.object({
  path: z.array(z.string().min(1).max(200)).min(2).max(8),
  value: z.unknown(),
  expectedRevision: z.number().int().nonnegative(),
});
export const AppSettingsSnapshotSchema = z.object({
  initialized: z.boolean(),
  revision: z.number().int().nonnegative(),
  values: z.record(z.string(), z.unknown()),
  fieldRevisions: z.record(z.string(), z.number().int().nonnegative()),
});
export type AppSettingsSnapshot = z.infer<typeof AppSettingsSnapshotSchema>;
export type AppSettingsPatch = z.infer<typeof AppSettingsPatchSchema>;
export const AppSettingsGetRequestSchema = z.object({
  type: z.literal("app.settings.get.request"),
  requestId: z.string(),
  subscribe: z.object({ subscriptionId: z.string().optional() }).optional(),
});
export const AppSettingsPatchRequestSchema = z.object({
  type: z.literal("app.settings.patch.request"),
  requestId: z.string(),
  initialize: z.boolean().optional(),
  patches: z.array(AppSettingsPatchSchema).min(1).max(256),
});
export const AppSettingsGetResponseSchema = z.object({
  type: z.literal("app.settings.get.response"),
  payload: z.object({
    requestId: z.string(),
    subscriptionId: z.string().optional(),
    snapshot: AppSettingsSnapshotSchema,
  }),
});
export const AppSettingsPatchResponseSchema = z.object({
  type: z.literal("app.settings.patch.response"),
  payload: z.object({
    requestId: z.string(),
    snapshot: AppSettingsSnapshotSchema,
    conflicts: z.array(z.array(z.string())),
  }),
});
export const AppSettingsChangedSchema = z.object({
  type: z.literal("app.settings.changed"),
  payload: z.object({ subscriptionId: z.string().optional(), snapshot: AppSettingsSnapshotSchema }),
});

/** Preference domains accepted for writes. Unrecognized stored fields remain readable and intact. */
export const SYNC_APP_SETTING_KEYS = [
  "paseoPlusPlus",
  "theme",
  "pluginThemeId",
  "language",
  "sendBehavior",
  "serviceUrlBehavior",
  "terminalScrollbackLines",
  "useLegacyTerminalRenderer",
  "uiFontFamily",
  "monoFontFamily",
  "uiBaseFontSize",
  "contentFontSize",
  "codeFontSize",
  "contentMaxWidth",
  "syntaxTheme",
  "workspaceTitleSource",
  "sidebarInitialWorkspaceCount",
  "sidebarWorkspaceTrailing",
  "sidebarRowItems",
  "sidebarChecksDisplay",
  "sidebarNavItems",
  "sidebarFooterItems",
  "usage",
  "autoExpandReasoning",
  "toolCallDetailLevel",
  "chatOutlineEnabled",
  "vimKeybindings",
  "openInSidePane",
  "pullRequestOpenLocation",
  "autoOpenExplorerSidebar",
  "explorerDiffScope",
  "workingDiffDefaultComparison",
  "workingDiffAutoSwitch",
] as const;
export const SYNC_SIDEBAR_SETTING_KEYS = [
  "groupMode",
  "sortMode",
  "workspaceSortMode",
  "projectVisibility",
  "groupEmptyProjects",
  "emptyProjectSortMode",
  "showBackground",
  "labelFilter",
] as const;
