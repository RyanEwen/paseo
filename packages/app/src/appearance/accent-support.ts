import { selectHostFeature, type HostFeatureSessionState } from "@/runtime/host-features";

/** Local preferences work independently; a selected settings authority must accept the new key. */
export function selectAccentColorSupport(
  state: HostFeatureSessionState,
  selectedHost: string | null,
): boolean {
  // COMPAT(appSettingsAccentColor): added in v0.11.2, remove gate after 2027-10-14.
  return selectedHost === null || selectHostFeature(state, selectedHost, "appSettingsAccentColor");
}

/**
 * Explicit initialization exports only preferences the selected host can store.
 * Never apply this to pending edits: those keep their original host and failure behavior.
 */
export function exportSupportedAccentSettings(
  app: Record<string, unknown>,
  supported: boolean,
): Record<string, unknown> {
  if (supported) return app;
  const { accentColor: _accentColor, ...rest } = app;
  return rest;
}
