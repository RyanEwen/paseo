import type { QueryClient } from "@tanstack/react-query";
import {
  APP_SETTINGS_QUERY_KEY,
  DEFAULT_CLIENT_SETTINGS,
  type AppSettings,
  type AppSettingsUpdate,
} from "@/hooks/use-settings/storage";
import { settingsDiff, isSyncedSettingsPath } from "@getpaseo/protocol/app-settings-values";
import type { SettingsSyncModel } from "./model";

/** Evaluate functional settings updates after prior durable edits, retaining their original host. */
export function createSyncedAppSettingsSave(
  model: SettingsSyncModel,
  loadSettings: () => Promise<AppSettings>,
  saveLocalUsageHost?: (queryClient: QueryClient, serverId: string | null) => Promise<void>,
) {
  let queue: Promise<unknown> = Promise.resolve();
  return async (queryClient: QueryClient, updates: AppSettingsUpdate): Promise<boolean> => {
    const starting = model.getState();
    if (starting.status === "local") return false;
    const adoptionSettled = ["ready", "offline", "readonly", "conflict"].includes(starting.status);
    if (!adoptionSettled) throw new Error("Load the selected host's settings before editing");
    const generation = model.getGeneration();
    const result = queue.then(() => saveEdit(queryClient, updates, generation));
    queue = result.catch(() => undefined);
    return result;
  };

  async function saveEdit(
    queryClient: QueryClient,
    updates: AppSettingsUpdate,
    generation: number,
  ): Promise<boolean> {
    if (generation !== model.getGeneration())
      throw new Error("Settings host changed before saving");
    const current =
      queryClient.getQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY) ?? (await loadSettings());
    if (generation !== model.getGeneration())
      throw new Error("Settings host changed while loading preferences");
    const patch = typeof updates === "function" ? updates(current) : updates;
    const next = { ...current, ...patch };
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const key of Object.keys(DEFAULT_CLIENT_SETTINGS) as (keyof AppSettings)[]) {
      before[key] = current[key];
      after[key] = next[key];
    }
    const patches = settingsDiff({ app: before }, { app: after }, model.getSnapshot()).filter(
      (item) => isSyncedSettingsPath(item.path),
    );
    if (next.usage.serverId !== current.usage.serverId) {
      if (!saveLocalUsageHost) throw new Error("Local Usage preferences are unavailable");
      await saveLocalUsageHost(queryClient, next.usage.serverId);
    }
    if (generation !== model.getGeneration())
      throw new Error("Settings host changed before saving");
    if (patches.length) await model.edit(patches);
    return true;
  }
}
