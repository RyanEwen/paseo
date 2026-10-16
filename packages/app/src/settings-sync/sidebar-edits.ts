import { SidebarModeProfilesSchema } from "@/stores/sidebar-mode-preferences";
import { isSettingsObject, settingsDiff } from "@getpaseo/protocol/app-settings-values";
import {
  reduceSidebarPreferences,
  type SidebarPreferencePatch,
  type SidebarViewStoreState,
  type SidebarGroupMode,
} from "@/stores/sidebar-view-store";
import type { SettingsSyncModel } from "./model";

/** Commands enter the existing durable outbox before changing either mode's projection. */
export function createSyncedSidebarSettingsSave(
  model: SettingsSyncModel,
  store: {
    getState(): SidebarViewStoreState;
    setState(patch: Partial<SidebarViewStoreState>): void;
  },
  supported: () => boolean,
) {
  let queue: Promise<unknown> = Promise.resolve();
  return (
    update: SidebarPreferencePatch,
    targetMode: SidebarGroupMode = store.getState().groupMode,
  ): Promise<void> => {
    const generation = model.getGeneration();
    const commit = async () => {
      if (generation !== model.getGeneration())
        throw new Error("Settings host changed before saving");
      if (!supported()) throw new Error("Update the settings host to save separate sidebar modes");
      const previous = store.getState();
      const next = reduceSidebarPreferences(previous, update, targetMode);
      if (model.getState().selectedHost === null) {
        store.setState(next);
        return undefined;
      }
      const snapshot = model.getSnapshot();
      const before = { groupMode: previous.groupMode, modeProfiles: previous.modeProfiles };
      const after = { groupMode: next.groupMode, modeProfiles: next.modeProfiles };
      const snapshotSidebar = isSettingsObject(snapshot.values.sidebar)
        ? snapshot.values.sidebar
        : {};
      const base = SidebarModeProfilesSchema.safeParse(snapshotSidebar.modeProfiles).success
        ? before
        : { groupMode: previous.groupMode };
      const patches = settingsDiff({ sidebar: base }, { sidebar: after }, snapshot);
      if (patches.length) await model.edit(patches);
      return undefined;
    };
    const result = queue.then(commit);
    queue = result.catch(() => undefined);
    return result;
  };
}
