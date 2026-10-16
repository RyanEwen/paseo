import { createSettingsHostTransport } from "./transport";
import { useEffect, useSyncExternalStore } from "react";
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

  useEffect(() => {
    const uninstall = installSettingsSyncSaveHandler(
      createSyncedAppSettingsSave(settingsSync, loadAppSettingsFromStorage, saveLocalUsageHost),
    );
    let initialized = false;
    let active = true;
    const owner = new AbortController();
    const updateGate = () => {
      const state = settingsSync.getState();
      setSettingsHostSelected(state.selectedHost !== null);
      setSettingsEditingBlocked(
        !initialized || !state.canWrite || !["local", "ready", "offline"].includes(state.status),
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
      initialized = true;
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
    if (!host) return;
    if (!client || !connected) {
      void settingsSync.connect(host, null);
      return;
    }
    const supported = client.getLastServerInfoMessage()?.features?.appSettingsSync === true;
    if (!supported) {
      void settingsSync.connect(host, {
        supported: false,
        writable: false,
        read: async () => {
          throw new Error("Update this host to sync settings");
        },
        patch: async () => {
          throw new Error("Update this host to sync settings");
        },
      });
      return;
    }
    const controller = new AbortController();
    const transport = createSettingsHostTransport({
      client,
      signal: controller.signal,
      onSnapshot: (snapshot) => {
        void settingsSync.receive(host, snapshot).catch(console.error);
      },
    });
    void settingsSync.connect(host, transport);
    return () => {
      controller.abort();
    };
  }, [host, client, connected]);
  return null;
}
