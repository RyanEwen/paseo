import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { AppSettingsSnapshot } from "@getpaseo/protocol/app-settings";
import type { SettingsSyncTransport } from "./model";
import { createSettingsHostTransport } from "./transport";

type SettingsClient = Pick<
  DaemonClient,
  "getLastServerInfoMessage" | "observeAppSettings" | "patchAppSettings" | "subscribeRawMessages"
>;

/** Authority changes replace the read owner; unrelated server-info broadcasts keep it. */
export function bindSettingsHost(input: {
  client: SettingsClient;
  onSnapshot(snapshot: AppSettingsSnapshot): void;
  onTransport(transport: SettingsSyncTransport): void;
}): () => void {
  let controller: AbortController | null = null;
  let authority: string | null = null;
  let stopped = false;
  const refresh = () => {
    const info = input.client.getLastServerInfoMessage();
    const next = JSON.stringify([
      info?.features?.appSettingsSync === true,
      info?.permissions?.includes("daemon.manage") === true,
    ]);
    if (stopped || next === authority) return;
    authority = next;
    controller?.abort();
    controller = new AbortController();
    input.onTransport(
      createSettingsHostTransport({
        client: input.client,
        signal: controller.signal,
        onSnapshot: input.onSnapshot,
      }),
    );
  };
  const stopListening = input.client.subscribeRawMessages((message) => {
    if (message.type === "status" && message.payload?.status === "server_info") refresh();
  });
  refresh();
  return () => {
    stopped = true;
    stopListening();
    controller?.abort();
  };
}
