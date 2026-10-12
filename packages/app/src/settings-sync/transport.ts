import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { AppSettingsSnapshot } from "@getpaseo/protocol/app-settings";
import type { SettingsSyncTransport } from "./model";

interface SettingsHostTransportInput {
  client: DaemonClient;
  signal: AbortSignal;
  onSnapshot(snapshot: AppSettingsSnapshot): void;
}

/** Own one live subscription and rebind explicit reads so a rejected bootstrap can be retried. */
export function createSettingsHostTransport(
  input: SettingsHostTransportInput,
): SettingsSyncTransport {
  let current: ReturnType<DaemonClient["observeAppSettings"]> | null = null;
  let stopListening = () => {};
  let readGeneration = 0;

  return {
    supported: true,
    writable:
      input.client.getLastServerInfoMessage()?.permissions?.includes("daemon.manage") === true,
    read,
    patch: (patches, initialize) => input.client.patchAppSettings(patches, initialize),
  };

  /** Replace failed or stale bootstrap ownership before reading; applying values never writes. */
  async function read(): Promise<AppSettingsSnapshot> {
    const generation = ++readGeneration;
    stopListening();
    const previous = current;
    current = null;
    if (previous) await previous.release();
    input.signal.throwIfAborted();
    if (generation !== readGeneration) throw new Error("Settings read was superseded");

    const subscription = input.client.observeAppSettings({ signal: input.signal });
    current = subscription;
    let initialized = false;
    stopListening = subscription.subscribe({
      snapshot: ({ snapshot }) => {
        if (initialized && active()) input.onSnapshot(snapshot);
      },
      update: (message) => {
        if (active() && message.type === "app.settings.changed")
          input.onSnapshot(message.payload.snapshot);
      },
    });
    try {
      const result = await subscription.ready;
      input.signal.throwIfAborted();
      initialized = true;
      return result.snapshot;
    } catch (error) {
      if (current === subscription) {
        stopListening();
        current = null;
      }
      await subscription.release();
      throw error;
    }

    function active(): boolean {
      return !input.signal.aborted && current === subscription && generation === readGeneration;
    }
  }
}
