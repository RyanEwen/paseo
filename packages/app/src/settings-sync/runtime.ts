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
  migrateSidebarViewState,
  subscribeSidebarPreferenceEdits,
} from "@/stores/sidebar-view-store";
import { DEFAULT_DESKTOP_SETTINGS } from "@/desktop/settings/desktop-settings";
import { isSettingsObject, settingsDiff } from "@getpaseo/protocol/app-settings-values";
import { SettingsSyncModel } from "./model";

const STORAGE_KEY = "app-settings-sync";
const SIDEBAR_KEYS = SYNC_SIDEBAR_SETTING_KEYS;
const deps: SettingsDeps = {
  storage: AsyncStorage,
  desktop: {
    isElectron: () => false,
    loadDesktopSettings: async () => DEFAULT_DESKTOP_SETTINGS,
    migrateLegacyDesktopSettings: async () => {},
  },
};
let applying = false;

/** Known preferences only. Credentials, host selection, layouts and drafts never enter this blob. */
export async function getDeviceSettingsValues(): Promise<Record<string, unknown>> {
  await queryClient.getQueryCache().find({ queryKey: APP_SETTINGS_QUERY_KEY })?.promise;
  const settings =
    queryClient.getQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY) ??
    (await loadAppSettingsFromStorage());
  const app: Record<string, unknown> = {};
  for (const key of SYNC_APP_SETTING_KEYS satisfies readonly (keyof AppSettings)[])
    app[key] = settings[key];
  app.usage = { displayAs: settings.usage.displayAs, pins: settings.usage.pins };
  if (!useSidebarViewStore.persist.hasHydrated()) {
    await useSidebarViewStore.persist.rehydrate();
    if (!useSidebarViewStore.persist.hasHydrated())
      throw new Error("Unable to load saved sidebar preferences");
  }
  const state = useSidebarViewStore.getState();
  const sidebar: Record<string, unknown> = {};
  for (const key of SIDEBAR_KEYS) sidebar[key] = state[key];
  return { app, sidebar };
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
  const sidebar = migrateSidebarViewState(isSettingsObject(values.sidebar) ? values.sidebar : {});
  const patch: Record<string, unknown> = {};
  for (const key of SIDEBAR_KEYS) patch[key] = sidebar[key];
  // Suppress only our synchronous projection. User actions during the async write stay queued.
  applying = true;
  try {
    useSidebarViewStore.setState(patch);
  } finally {
    applying = false;
  }
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

/** Sidebar actions already own their persisted store. Forward only intentional changed leaves. */
export function observeSidebarSettingsEdits(): () => void {
  return subscribeSidebarPreferenceEdits((next, previous) => {
    if (applying || settingsSync.getState().selectedHost === null) return;
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const key of SIDEBAR_KEYS) {
      before[key] = previous[key];
      after[key] = next[key];
    }
    const patches = settingsDiff(
      { sidebar: before },
      { sidebar: after },
      settingsSync.getSnapshot(),
    );
    if (!patches.length) return;
    void settingsSync.edit(patches).catch(() => {
      applying = true;
      const restore: Record<string, unknown> = {};
      for (const key of SIDEBAR_KEYS) restore[key] = previous[key];
      useSidebarViewStore.setState(restore);
      applying = false;
    });
  });
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
