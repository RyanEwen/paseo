import { normalizeRemoteSidebarModes } from "./sidebar-values";
import { createSyncedSidebarSettingsSave } from "./sidebar-edits";
import type { QueryClient } from "@tanstack/react-query";
import { SYNC_APP_SETTING_KEYS, SYNC_SIDEBAR_SETTING_KEYS } from "@getpaseo/protocol/app-settings";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { queryClient } from "@/data/query-client";
import {
  APP_SETTINGS_QUERY_KEY,
  normalizeAppSettings,
  saveAppSettings,
  type AppSettings,
  type SettingsDeps,
} from "@/hooks/use-settings/storage";
import { loadAppSettingsFromStorage } from "@/hooks/use-settings";
import {
  useSidebarViewStore,
  installSidebarPreferenceCommitter,
  initializeSidebarModePreferences,
  projectSidebarMode,
} from "@/stores/sidebar-view-store";
import { exportLegacySidebarPresentation } from "@/stores/sidebar-mode-preferences";
import { DEFAULT_DESKTOP_SETTINGS } from "@/desktop/settings/desktop-settings";
import { isSettingsObject } from "@getpaseo/protocol/app-settings-values";
import { SettingsSyncModel } from "./model";

import { selectHostFeature } from "@/runtime/host-features";
import { useSessionStore } from "@/stores/session-store";
import {
  selectAccentColorSupport,
  exportSupportedAccentSettings,
} from "@/appearance/accent-support";

const STORAGE_KEY = "app-settings-sync";
const SIDEBAR_KEYS = ["groupMode", "modeProfiles"] as const;
const LEGACY_PRESENTATION_KEYS = new Set([
  "workspaceTitleSource",
  "sidebarInitialWorkspaceCount",
  "sidebarWorkspaceTrailing",
  "sidebarRowItems",
  "sidebarChecksDisplay",
]);
export function sidebarModeProfilesSupported(): boolean {
  const host = settingsSync.getState().selectedHost;
  // COMPAT(appSettingsSidebarModeProfiles): added in v0.11.2, remove after 2027-10-16.
  return (
    host === null ||
    selectHostFeature(useSessionStore.getState(), host, "appSettingsSidebarModeProfiles")
  );
}
export async function initializeDeviceSidebarModes(): Promise<void> {
  await queryClient.getQueryCache().find({ queryKey: APP_SETTINGS_QUERY_KEY })?.promise;
  const settings =
    queryClient.getQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY) ??
    (await loadAppSettingsFromStorage());
  if (!useSidebarViewStore.persist.hasHydrated()) await useSidebarViewStore.persist.rehydrate();
  if (!useSidebarViewStore.persist.hasHydrated())
    throw new Error("Unable to load saved sidebar preferences");
  initializeSidebarModePreferences(settings);
}
const deps: SettingsDeps = {
  storage: AsyncStorage,
  desktop: {
    isElectron: () => false,
    loadDesktopSettings: async () => DEFAULT_DESKTOP_SETTINGS,
    migrateLegacyDesktopSettings: async () => {},
  },
};

/**
 * Read known preferences, excluding credentials, host selection, layouts and drafts.
 * Backup preserves every choice; publish alone omits a field unsupported by the chosen host.
 */
export async function getDeviceSettingsValues(
  purpose: "backup" | "publish" = "backup",
): Promise<Record<string, unknown>> {
  await queryClient.getQueryCache().find({ queryKey: APP_SETTINGS_QUERY_KEY })?.promise;
  const settings =
    queryClient.getQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY) ??
    (await loadAppSettingsFromStorage());
  await initializeDeviceSidebarModes();
  const app: Record<string, unknown> = {};
  for (const key of SYNC_APP_SETTING_KEYS satisfies readonly (keyof AppSettings)[])
    if (!LEGACY_PRESENTATION_KEYS.has(key)) app[key] = settings[key];
  app.usage = { displayAs: settings.usage.displayAs, pins: settings.usage.pins };
  if (!useSidebarViewStore.persist.hasHydrated()) {
    await useSidebarViewStore.persist.rehydrate();
    if (!useSidebarViewStore.persist.hasHydrated())
      throw new Error("Unable to load saved sidebar preferences");
  }
  const state = useSidebarViewStore.getState();
  const sidebar: Record<string, unknown> = {};
  for (const key of SIDEBAR_KEYS) sidebar[key] = state[key];
  if (purpose === "backup") return { app, sidebar };
  if (!sidebarModeProfilesSupported()) {
    delete sidebar.modeProfiles;
    for (const key of SYNC_SIDEBAR_SETTING_KEYS) {
      if (key !== "modeProfiles") sidebar[key] = state[key];
    }
    Object.assign(app, exportLegacySidebarPresentation(state.modeProfiles[state.groupMode]));
  }
  const supported = selectAccentColorSupport(
    useSessionStore.getState(),
    settingsSync.getState().selectedHost,
  );
  return { app: exportSupportedAccentSettings(app, supported), sidebar };
}

/** Project host values through the existing normalization and durable app write path. */
async function applyValues(values: Record<string, unknown>): Promise<void> {
  // Let any initial hydration finish before replacing the same cache and durable storage.
  await queryClient.getQueryCache().find({ queryKey: APP_SETTINGS_QUERY_KEY })?.promise;
  const app = normalizeAppSettings(isSettingsObject(values.app) ? values.app : {});
  // Historical hosts may still store serverId. It remains untouched on the host and device.
  await saveAppSettings({
    queryClient,
    updates: (current) => ({ ...app, usage: { ...app.usage, serverId: current.usage.serverId } }),
    deps,
  });
  const sidebar = normalizeRemoteSidebarModes(values.sidebar, app);
  const modeProfiles = sidebar.modeProfiles;
  const patch = {
    ...projectSidebarMode({
      ...sidebar,
      modeProfiles,
      localModeFilters: useSidebarViewStore.getState().localModeFilters,
    }),
    modeProfilesInitialized: true,
  };
  useSidebarViewStore.setState(patch);
}

export const settingsSync = new SettingsSyncModel({
  readLocal: async () => {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw === null ? null : JSON.parse(raw);
  },
  writeLocal: async (value) => AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(value)),
  getDeviceValues: getDeviceSettingsValues,
  applyValues,
});

/** Serialize commands before projection; failed durable writes never roll back newer UI state. */
export function observeSidebarSettingsEdits(): () => void {
  return installSidebarPreferenceCommitter(
    createSyncedSidebarSettingsSave(
      settingsSync,
      useSidebarViewStore,
      sidebarModeProfilesSupported,
    ),
  );
}

/** The report host stays local even when the rest of Usage preferences sync. */
export async function saveLocalUsageHost(
  client: QueryClient,
  serverId: string | null,
): Promise<void> {
  await saveAppSettings({
    queryClient: client,
    updates: (current) => ({ usage: { ...current.usage, serverId } }),
    deps,
  });
}
