import type { SessionInboundMessage, SessionOutboundMessage } from "@getpaseo/protocol/messages";
import type { AppSettingsSnapshot } from "@getpaseo/protocol/app-settings";
import type { SessionDelivery } from "../session/owned-subscriptions/index.js";
import { AppSettingsStore } from "./index.js";

/** Settings RPC adapter. Subscription lifetimes belong to the existing delivery owner. */
export class AppSettingsSession {
  private readonly store: AppSettingsStore;
  constructor(
    private readonly emit: (message: SessionOutboundMessage) => void,
    private readonly delivery: SessionDelivery,
    paseoHome: string,
    store?: AppSettingsStore,
  ) {
    this.store = store ?? new AppSettingsStore(paseoHome);
  }

  dispatch(message: SessionInboundMessage): Promise<void> | undefined {
    if (message.type === "app.settings.get.request") return this.get(message);
    if (message.type === "app.settings.patch.request") return this.patch(message);
    return undefined;
  }

  /** Subscribe before reading, buffering any write that lands during snapshot acquisition. */
  private async get(
    request: Extract<SessionInboundMessage, { type: "app.settings.get.request" }>,
  ): Promise<void> {
    if (!request.subscribe) {
      this.emit({
        type: "app.settings.get.response",
        payload: { requestId: request.requestId, snapshot: await this.store.read() },
      });
      return;
    }
    let unsubscribe = () => {};
    const owner = this.delivery.begin("app-settings", request.subscribe.subscriptionId, () =>
      unsubscribe(),
    );
    let ready = false;
    let pending: AppSettingsSnapshot | null = null;
    unsubscribe = this.store.subscribe((snapshot) => {
      if (!ready) pending = snapshot;
      else owner.emit({ type: "app.settings.changed", payload: { snapshot } });
    });
    try {
      const snapshot = await this.store.read();
      if (owner.signal.aborted) {
        unsubscribe();
        return;
      }
      this.emit({
        type: "app.settings.get.response",
        payload: { requestId: request.requestId, subscriptionId: owner.responseId, snapshot },
      });
      ready = true;
      const buffered = pending as AppSettingsSnapshot | null;
      if (buffered && buffered.revision > snapshot.revision)
        owner.emit({ type: "app.settings.changed", payload: { snapshot: buffered } });
    } catch (error) {
      await owner.release();
      throw error;
    }
  }

  private async patch(
    request: Extract<SessionInboundMessage, { type: "app.settings.patch.request" }>,
  ): Promise<void> {
    const result = await this.store.patch(request.patches, request.initialize);
    this.emit({
      type: "app.settings.patch.response",
      payload: { requestId: request.requestId, ...result },
    });
  }
}
