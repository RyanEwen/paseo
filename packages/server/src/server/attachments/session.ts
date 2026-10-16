import {
  FileTransferOpcode,
  encodeFileTransferFrame,
} from "@getpaseo/protocol/binary-frames/file-transfer";
import type { SessionInboundMessage, SessionOutboundMessage } from "../messages.js";
import { AttachmentStore, AttachmentStoreError, type AttachmentReadLease } from "./store.js";
import { withAttachmentResource } from "./io.js";

type AttachmentRequest = Extract<
  SessionInboundMessage,
  {
    type:
      | "attachments.list.request"
      | "attachments.get.request"
      | "attachments.read.request"
      | "attachments.read.cancel.request";
  }
>;
interface AttachmentSessionHost {
  emit(message: SessionOutboundMessage, source: object): void;
  send(frame: Uint8Array, source: object): Promise<void>;
  supportsOriginals(source: object): boolean;
  mayRead(): boolean;
  requestSignal(): AbortSignal;
  reportFailure?(error: unknown): void;
}
function waitForTransfer<T>(signal: AbortSignal, operation: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    operation.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        return resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        return reject(error);
      },
    );
  });
}
interface AttachmentOperation {
  cancel: AbortController;
  signal: AbortSignal;
  kind: "read" | "metadata";
  resetIdle(): void;
  clearTimers(): void;
}
export class AttachmentSession {
  private readonly transfers = new Map<object, Map<string, AttachmentOperation>>();
  constructor(
    private readonly store: AttachmentStore | undefined,
    private readonly host: AttachmentSessionHost,
  ) {}
  revokeReads(): void {
    for (const sourceTransfers of this.transfers.values())
      for (const transfer of sourceTransfers.values())
        transfer.cancel.abort(
          new AttachmentStoreError("Original transfer permission was revoked."),
        );
  }
  async handle(request: AttachmentRequest, source: object): Promise<void> {
    const requestId = request.requestId;
    if (request.type === "attachments.read.cancel.request") {
      const transfer = this.transfers.get(source)?.get(request.readRequestId);
      const canceled = transfer?.kind === "read";
      if (canceled && transfer)
        transfer.cancel.abort(new AttachmentStoreError("Original transfer canceled."));
      this.host.emit(
        { type: "attachments.read.cancel.response", payload: { canceled, error: null, requestId } },
        source,
      );
      return;
    }
    try {
      if (!this.host.mayRead())
        throw new AttachmentStoreError("Original attachment permission is unavailable.");
      if (!this.store)
        throw new AttachmentStoreError("Attachment storage is unavailable on this host.");
      if (request.type === "attachments.list.request") {
        const result = await this.store.list(request.agentId, request.after, request.limit);
        this.host.emit(
          { type: "attachments.list.response", payload: { ...result, error: null, requestId } },
          source,
        );
      } else if (request.type === "attachments.get.request") {
        const reference = await this.metadata(request, source, this.store);
        this.host.emit(
          { type: "attachments.get.response", payload: { reference, error: null, requestId } },
          source,
        );
      } else {
        const reference = await this.read(request, source, this.store);
        this.host.emit(
          { type: "attachments.read.response", payload: { reference, error: null, requestId } },
          source,
        );
      }
    } catch (error) {
      this.host.reportFailure?.(error);
      const message =
        error instanceof AttachmentStoreError
          ? error.message
          : "Original attachment is unavailable or could not be read.";
      if (request.type === "attachments.list.request")
        this.host.emit(
          {
            type: "attachments.list.response",
            payload: { references: [], next: null, error: message, requestId },
          },
          source,
        );
      else if (request.type === "attachments.get.request")
        this.host.emit(
          {
            type: "attachments.get.response",
            payload: { reference: null, error: message, requestId },
          },
          source,
        );
      else
        this.host.emit(
          {
            type: "attachments.read.response",
            payload: { reference: null, error: message, requestId },
          },
          source,
        );
    }
  }
  private beginOperation(
    source: object,
    requestId: string,
    store: AttachmentStore,
    kind: AttachmentOperation["kind"],
  ): AttachmentOperation {
    if (this.transfers.get(source)?.has(requestId))
      throw new AttachmentStoreError("Original transfer request ID is already active.");
    const cancel = new AbortController();
    const signal = AbortSignal.any([cancel.signal, this.host.requestSignal()]);
    let idle: ReturnType<typeof setTimeout> | undefined;
    const resetIdle = () => {
      if (idle) clearTimeout(idle);
      idle = setTimeout(
        () => cancel.abort(new AttachmentStoreError("Original transfer stalled.")),
        store.limits.readIdleMs,
      );
    };
    const total = setTimeout(
      () => cancel.abort(new AttachmentStoreError("Original transfer exceeded its deadline.")),
      store.limits.readTotalMs,
    );
    const operation = {
      cancel,
      signal,
      kind,
      resetIdle,
      clearTimers: () => {
        clearTimeout(total);
        if (idle) clearTimeout(idle);
      },
    };
    const entries = this.transfers.get(source) ?? new Map<string, AttachmentOperation>();
    entries.set(requestId, operation);
    this.transfers.set(source, entries);
    resetIdle();
    return operation;
  }
  private forget(source: object, requestId: string, operation: AttachmentOperation): void {
    const entries = this.transfers.get(source);
    if (entries?.get(requestId) !== operation) return;
    entries.delete(requestId);
    if (!entries.size) this.transfers.delete(source);
  }
  private async metadata(
    request: Extract<AttachmentRequest, { type: "attachments.get.request" }>,
    source: object,
    store: AttachmentStore,
  ) {
    const operation = this.beginOperation(source, request.requestId, store, "metadata");
    try {
      return await store.get(request.agentId, request.referenceId, this, operation.signal);
    } finally {
      operation.clearTimers();
      this.forget(source, request.requestId, operation);
    }
  }
  private async read(
    request: Extract<AttachmentRequest, { type: "attachments.read.request" }>,
    source: object,
    store: AttachmentStore,
  ) {
    // Check the initiating physical source before a lease or image buffer exists.
    if (!this.host.supportsOriginals(source))
      throw new AttachmentStoreError(
        "This connection does not support acknowledged original-image transfers. Metadata remains available.",
      );
    const operation = this.beginOperation(source, request.requestId, store, "read");
    let lease: AttachmentReadLease | undefined;
    try {
      lease = await store.openRead(request.agentId, request.referenceId, this, operation.signal);
      const ownedLease = lease;
      return await withAttachmentResource(
        async () => {
          const send = async (frame: Uint8Array) => {
            operation.signal.throwIfAborted();
            const pending = ownedLease.dispatchSend(() => {
              operation.signal.throwIfAborted();
              if (!this.host.mayRead() || !this.host.supportsOriginals(source))
                throw new AttachmentStoreError(
                  "Original transfer source or permission is no longer available.",
                );
              return this.host.send(frame, source);
            });
            await waitForTransfer(operation.signal, pending);
            operation.resetIdle();
          };
          const reference = ownedLease.reference;
          await send(
            encodeFileTransferFrame({
              opcode: FileTransferOpcode.FileBegin,
              requestId: request.requestId,
              metadata: {
                mime: reference.mimeType,
                size: reference.byteLength,
                encoding: "binary",
                modifiedAt: reference.createdAt,
                revision: reference.sha256,
              },
            }),
          );
          for await (const chunk of ownedLease.chunks(operation.signal))
            await send(
              encodeFileTransferFrame({
                opcode: FileTransferOpcode.FileChunk,
                requestId: request.requestId,
                payload: chunk,
              }),
            );
          await send(
            encodeFileTransferFrame({
              opcode: FileTransferOpcode.FileEnd,
              requestId: request.requestId,
            }),
          );
          return reference;
        },
        () => ownedLease.close(),
      );
    } finally {
      operation.clearTimers();
      if (lease) {
        // The caller/file can finish before the physical send. Keep its source/ID and budget occupied.
        void lease.settled.then(() => this.forget(source, request.requestId, operation));
      } else this.forget(source, request.requestId, operation);
    }
  }
}
