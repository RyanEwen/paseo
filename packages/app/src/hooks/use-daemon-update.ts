import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getHostRuntimeStore,
  isHostRuntimeConnected,
  useHostRuntimeClient,
} from "@/runtime/host-runtime";
import type { HostProfile } from "@/types/host-connection";
import { confirmDialog } from "@/utils/confirm-dialog";
import { updateDaemonFromSettings } from "@/screens/settings/daemon-lifecycle";

type DaemonUpdateState =
  | { status: "idle" }
  | { status: "complete"; workerVersion: string }
  | { status: "updating"; phase: string }
  | { status: "failed"; title: string; message: string };

/**
 * Share confirmation, progress, and replacement-worker verification across host surfaces.
 * handleUpdate returns false on cancellation or a duplicate press, and true after a displayed outcome.
 * Unmount detaches progress feedback; it does not cancel an acknowledged host update.
 */
export function useDaemonUpdate(host: Pick<HostProfile, "serverId" | "label">) {
  const { t } = useTranslation();
  const daemonClient = useHostRuntimeClient(host.serverId);
  const runtime = getHostRuntimeStore();
  const [updateState, setUpdateState] = useState<DaemonUpdateState>({ status: "idle" });
  const isMountedRef = useRef(true);
  const requestInProgressRef = useRef(false);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      unsubscribeRef.current?.();
    };
  }, []);

  const isHostConnected = useCallback(
    () => isHostRuntimeConnected(runtime.getSnapshot(host.serverId)),
    [host.serverId, runtime],
  );
  const handleUpdate = useCallback(async () => {
    // Keep the guard synchronous so repeated presses cannot open overlapping confirmations.
    if (requestInProgressRef.current) return false;
    if (!daemonClient) {
      setUpdateState({
        status: "failed",
        title: t("settings.host.daemon.update.unavailableTitle"),
        message: t("settings.host.daemon.update.unavailableMessage"),
      });
      return true;
    }
    if (!isHostConnected()) {
      setUpdateState({
        status: "failed",
        title: t("settings.host.daemon.update.offlineTitle"),
        message: t("settings.host.daemon.update.offlineMessage"),
      });
      return true;
    }

    requestInProgressRef.current = true;
    try {
      let confirmed: boolean;
      try {
        confirmed = await confirmDialog({
          title: t("settings.host.daemon.update.confirmTitle", { name: host.label }),
          message: t("settings.host.daemon.update.confirmMessage"),
          confirmLabel: t("settings.host.daemon.update.confirm"),
          cancelLabel: t("common.actions.cancel"),
          destructive: false,
        });
      } catch {
        if (isMountedRef.current) {
          setUpdateState({
            status: "failed",
            title: t("settings.host.daemon.update.requestFailedTitle"),
            message: t("settings.host.daemon.update.dialogFailedMessage"),
          });
        }
        return true;
      }
      if (!confirmed || !isMountedRef.current) return false;

      setUpdateState({
        status: "updating",
        phase: t("settings.host.daemon.update.phaseStarting"),
      });
      const requestId = `settings_daemon_update_${host.serverId}`;
      const progressLabels = {
        starting: t("settings.host.daemon.update.phaseStarting"),
        downloading: t("settings.host.daemon.update.phaseDownloading"),
        installing: t("settings.host.daemon.update.phaseInstalling"),
        complete: t("settings.host.daemon.update.phaseComplete"),
      };
      const unsubscribe = daemonClient.on("daemon.update.progress", (message) => {
        if (message.payload.requestId !== requestId || !isMountedRef.current) return;
        setUpdateState({ status: "updating", phase: progressLabels[message.payload.phase] });
      });
      unsubscribeRef.current = unsubscribe;

      // Installation acknowledgement is insufficient: the shared lifecycle verifies the new worker.
      try {
        const { workerVersion } = await updateDaemonFromSettings(host.serverId, {
          updateDaemon: () => daemonClient.updateDaemon(requestId),
          getStatus: async () => ({
            ...(await daemonClient.getDaemonStatus()),
            serverId: daemonClient.getLastServerInfoMessage()?.serverId ?? "",
            version: daemonClient.getLastServerInfoMessage()?.version ?? null,
          }),
        });
        if (isMountedRef.current) setUpdateState({ status: "complete", workerVersion });
      } catch (error) {
        if (isMountedRef.current) {
          setUpdateState({
            status: "failed",
            title: t("settings.host.daemon.update.requestFailedTitle"),
            message: t("settings.host.daemon.update.requestFailedMessage", {
              error: error instanceof Error ? error.message : "Unknown error",
            }),
          });
        }
      } finally {
        unsubscribeRef.current = null;
        unsubscribe();
      }
      return true;
    } finally {
      requestInProgressRef.current = false;
    }
  }, [daemonClient, host.label, host.serverId, isHostConnected, t]);

  return { updateState, handleUpdate };
}
