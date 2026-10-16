import { z } from "zod";

/** App preference opt-outs for optional fork UI. Disabling never deletes feature data. */
const preferencesObject = z.looseObject({
  // Retain the released key so existing chat-link opt-outs also apply to all workspace links.
  workspaceChatLinks: z.boolean().catch(true),
  sidebarHostUpdates: z.boolean().catch(true),
  mobileWorkspaceTabs: z.boolean().catch(true),
  widerWorkspaceTabs: z.boolean().catch(true),
  splitLayoutPresets: z.boolean().catch(true),
  descriptiveToolCalls: z.boolean().catch(true),
  stickyUserPrompts: z.boolean().catch(true),
  previousAgents: z.boolean().catch(true),
  sidebarProjectSelector: z.boolean().catch(true),
  sidebarActivityChips: z.boolean().catch(true),
  sidebarProjectEmphasis: z.boolean().catch(true),
  sidebarBulkActions: z.boolean().catch(true),
  projectPinning: z.boolean().catch(true),
  sidebarWorkspaceTransitions: z.boolean().catch(true),
  androidAutomaticUpdateChecks: z.boolean().catch(true),
});

export const DEFAULT_PASEO_PLUS_PLUS_PREFERENCES = preferencesObject.parse({});
export const PaseoPlusPlusPreferencesSchema = preferencesObject.catch(
  DEFAULT_PASEO_PLUS_PLUS_PREFERENCES,
);

export type PaseoPlusPlusPreferences = z.output<typeof PaseoPlusPlusPreferencesSchema>;
export type PaseoPlusPlusFeature = keyof typeof preferencesObject.shape;
