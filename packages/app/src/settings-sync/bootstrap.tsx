import { bindSettingsHost } from "./binding";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { loadAppSettingsFromStorage } from "@/hooks/use-settings";
import { createSyncedAppSettingsSave } from "./app-edits";
import {
  settingsSync,
  observeSidebarSettingsEdits,
  saveLocalUsageHost,
  initializeDeviceSidebarModes,
} from "./runtime";
import {
  installSettingsSyncSaveHandler,
  setSettingsEditingBlocked,
  setSettingsHostSelected,
} from "./save-handler";

export function useSettingsSyncState() {
  return useSyncExternalStore(settingsSync.subscribe, settingsSync.getState, settingsSync.getState);
}

/** One app-wide owner, independent of the active workspace or the settings screen's lifetime. */
export function SettingsSyncBootstrap() {
  const syncState = useSettingsSyncState();
  const host = syncState.selectedHost ?? "";
  const client = useHostRuntimeClient(host);
  const connected = useHostRuntimeIsConnected(host);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    const uninstall = installSettingsSyncSaveHandler(
      createSyncedAppSettingsSave(settingsSync, loadAppSettingsFromStorage, saveLocalUsageHost),
    );
    let hydrated = false;
    let active = true;
    const owner = new AbortController();
    const updateGate = () => {
      const state = settingsSync.getState();
      setSettingsHostSelected(state.selectedHost !== null);
      setSettingsEditingBlocked(
        !hydrated || !state.canWrite || !["local", "ready", "offline"].includes(state.status),
      );
    };
    updateGate();
    const stopGate = settingsSync.subscribe(updateGate);
    const stopSidebar = observeSidebarSettingsEdits();
    const initialize = async () => {
      await initializeDeviceSidebarModes();
      if (!active) return;
      await settingsSync.load(owner.signal);
      if (!active) return;
      hydrated = true;
      setInitialized(true);
      updateGate();
    };
    void initialize().catch(console.error);
    return () => {
      active = false;
      owner.abort();
      uninstall();
      stopGate();
      stopSidebar();
    };
  }, []);

  useEffect(() => {
    if (!initialized || !host) return;
    if (!client || !connected) {
      void settingsSync.connect(host, null);
      return;
    }
    return bindSettingsHost({
      client,
      onSnapshot: (snapshot) => {
        void settingsSync.receive(host, snapshot).catch(console.error);
      },
      onTransport: (transport) => {
        void settingsSync.connect(host, transport);
      },
    });
  }, [initialized, host, client, connected]);
  return null;
}
