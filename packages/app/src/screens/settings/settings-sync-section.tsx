import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  SettingsAction,
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
} from "@/components/settings";
import { useHosts } from "@/runtime/host-runtime";
import { useSettingsSyncState } from "@/settings-sync/bootstrap";
import { settingsSync } from "@/settings-sync/runtime";

/** Explicit settings authority selection, remote adoption and empty-host initialization. */
export function SettingsSyncSection() {
  const { t } = useTranslation();
  const hosts = useHosts();
  const state = useSettingsSyncState();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }, []);
  const chooseHost = useCallback(
    (value: string) => {
      void run(() => settingsSync.selectHost(value || null));
    },
    [run],
  );
  const publish = useCallback(() => {
    void run(() => settingsSync.publishDeviceSettings());
  }, [run]);
  const useHost = useCallback(() => {
    void run(() => settingsSync.useHostSettings());
  }, [run]);
  const keepDevice = useCallback(() => {
    void run(() => settingsSync.keepDeviceChanges());
  }, [run]);
  const restoreDevice = useCallback(() => {
    void run(() => settingsSync.restoreDeviceSettings());
  }, [run]);
  const retry = useCallback(() => {
    void run(() => settingsSync.retry());
  }, [run]);
  const options = [
    { value: "", label: t("settingsSync.deviceOnly") },
    ...hosts.map((host) => ({ value: host.serverId, label: host.label || host.serverId })),
  ];
  if (state.selectedHost && !hosts.some((host) => host.serverId === state.selectedHost))
    options.push({ value: state.selectedHost, label: t("settingsSync.unavailableHost") });

  const selectedLabel =
    options.find((option) => option.value === state.selectedHost)?.label ?? state.selectedHost;

  return (
    <SettingsSection title={t("settingsSync.title")} info={t("settingsSync.hint")}>
      <SettingsCard testID="settings-sync">
        <SettingsSelect
          label={t("settingsSync.host")}
          value={state.selectedHost ?? ""}
          options={options}
          onValueChange={chooseHost}
          disabled={busy || state.status === "loading"}
        />
        <SettingsRow
          label={t("settingsSync.status")}
          hint={t(`settingsSync.states.${state.status}`, { count: state.pendingCount })}
          error={error ?? state.error ?? undefined}
        />
        {state.status === "empty" && state.canWrite ? (
          <SettingsAction
            label={t("settingsSync.publishHint")}
            actionLabel={t("settingsSync.publish")}
            onPress={publish}
            disabled={busy}
          />
        ) : null}
        {state.status === "conflict" ? (
          <SettingsAction
            label={t("settingsSync.conflictHint", { host: selectedLabel })}
            actionLabel={t("settingsSync.useHost")}
            onPress={useHost}
            disabled={busy}
          />
        ) : null}
        {state.status === "conflict" && state.canWrite ? (
          <SettingsAction
            label={t("settingsSync.keepDeviceHint", { host: selectedLabel })}
            actionLabel={t("settingsSync.keepDevice")}
            onPress={keepDevice}
            disabled={busy}
          />
        ) : null}
        {state.selectedHost &&
        ["ready", "offline", "readonly", "conflict"].includes(state.status) ? (
          <SettingsAction
            label={t("settingsSync.restoreHint")}
            actionLabel={t("settingsSync.restore")}
            onPress={restoreDevice}
            disabled={busy}
          />
        ) : null}
        {state.status === "error" || state.status === "readonly" ? (
          <SettingsAction
            label={t("settingsSync.retryHint")}
            actionLabel={t("common.actions.retry")}
            onPress={retry}
            disabled={busy}
          />
        ) : null}
      </SettingsCard>
    </SettingsSection>
  );
}
