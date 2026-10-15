import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useFetchQuery } from "@/data/query";
import { useDaemonUpdate } from "@/hooks/use-daemon-update";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import type { HostProfile } from "@/types/host-connection";

interface HostUpdateActionProps {
  host: HostProfile;
  supportsAvailability: boolean;
  legacyManualUpdate: boolean;
  daemonVersion: string | null;
  enabled: boolean;
  busy: boolean;
  onUpdate: (host: HostProfile) => void;
}

/** Footer-only action: failures and unknown eligibility never become an update invitation. */
export function HostUpdateAction({
  host,
  supportsAvailability,
  legacyManualUpdate,
  daemonVersion,
  enabled,
  busy,
  onUpdate,
}: HostUpdateActionProps) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(host.serverId);
  const connected = useHostRuntimeIsConnected(host.serverId);
  const canCheck = enabled && supportsAvailability && connected && client !== null;
  const query = useFetchQuery({
    queryKey: ["daemon-update-availability", host.serverId, daemonVersion],
    enabled: canCheck,
    queryFn: async () => {
      if (!client) throw new Error("Host disconnected");
      return client.checkDaemonUpdateAvailability();
    },
    dataShape: "value",
    staleTimeMs: 0,
    retry: false,
  });
  const confirmedVersion = query.data?.version ?? null;
  const checkSettled = !query.isFetching && !query.isError;
  const canRunUpdate = enabled && connected && client !== null;
  const hasConfirmedUpdate = supportsAvailability && checkSettled && confirmedVersion !== null;
  const hasLegacyManualUpdate = legacyManualUpdate && canRunUpdate;
  const eligible = hasLegacyManualUpdate || (canRunUpdate && hasConfirmedUpdate);
  const handleUpdate = useCallback(
    (event: { stopPropagation: () => void }) => {
      event.stopPropagation();
      onUpdate(host);
    },
    [host, onUpdate],
  );
  if (!eligible) return null;

  return (
    <Button
      size="xs"
      variant="outline"
      disabled={busy}
      accessibilityLabel={`${t("settings.host.daemon.update.confirm")} ${host.label}`}
      testID={`sidebar-host-update-${host.serverId}`}
      onPress={handleUpdate}
    >
      {t("settings.host.daemon.update.confirm")}
    </Button>
  );
}

interface HostUpdateSheetProps {
  host: HostProfile;
  onFinished: () => void;
  onClose: () => void;
}

/** Live outside the picker so its dismissal cannot discard update progress or verification. */
export function HostUpdateSheet({ host, onFinished, onClose }: HostUpdateSheetProps) {
  const { t } = useTranslation();
  const { updateState, handleUpdate } = useDaemonUpdate(host);
  const started = useRef(false);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    async function startUpdate() {
      try {
        const attempted = await handleUpdate();
        if (!attempted) onClose();
      } finally {
        onFinished();
      }
    }
    void startUpdate();
  }, [handleUpdate, onFinished, onClose]);

  const updating = updateState.status === "updating";
  const dismiss = useCallback(() => {
    // Dismiss the presentation while the mounted owner continues worker verification.
    if (updating) setDismissed(true);
    else onClose();
  }, [onClose, updating]);
  const header = useMemo(
    () => ({ title: t("settings.host.daemon.update.confirmTitle", { name: host.label }) }),
    [host.label, t],
  );
  return (
    <AdaptiveModalSheet
      visible={!dismissed && updateState.status !== "idle"}
      header={header}
      onClose={dismiss}
      desktopMaxWidth={480}
      testID="sidebar-host-update-sheet"
    >
      <View style={styles.content}>
        {updateState.status === "updating" ? (
          <Text style={styles.text}>{updateState.phase}</Text>
        ) : null}
        {updateState.status === "complete" ? (
          <Alert
            variant="success"
            size="sm"
            title={t("desktop.daemon.lifecycle.workerUpdated", {
              version: updateState.workerVersion,
            })}
            description={t("desktop.daemon.lifecycle.supervisorRefresh")}
          />
        ) : null}
        {updateState.status === "failed" ? (
          <Alert
            variant="error"
            size="sm"
            title={updateState.title}
            description={updateState.message}
          />
        ) : null}
        <Button variant="outline" onPress={dismiss}>
          {t("common.actions.close")}
        </Button>
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: { padding: theme.spacing[4], gap: theme.spacing[4] },
  text: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
}));
