import { EventEmitter } from "node:events";
import type { Readable, Writable } from "node:stream";

const MAX_MESSAGE_BYTES = 64 * 1024 * 1024;
const MAX_PENDING_COMMANDS = 256;

interface PendingCommand {
  resolve(value: unknown): void;
  reject(error: Error): void;
  dispose(): void;
}

export interface CdpEvent {
  method: string;
  params?: Record<string, unknown>;
  sessionId?: string;
}

/** Chromium's private inherited CDP pipe. No TCP listener or renderer access.
 * Cancellation abandons a reply, never recalls or replays a published command.
 * The session owner must fence uncertain mutations before admitting more input.
 */
export class CdpPipe extends EventEmitter {
  private nextId = 0;
  private readonly pending = new Map<number, PendingCommand>();
  private fragments: Buffer[] = [];
  private fragmentBytes = 0;
  private closedError: Error | null = null;

  public constructor(
    private readonly output: Writable,
    private readonly input: Readable,
  ) {
    super();
    input.on("data", this.receive);
    input.once("end", this.onEnd);
    input.on("error", this.onError);
    output.on("error", this.onError);
    // Node can emit EPIPE after a write callback has already closed the pipe.
    // Keep error ownership until each stream is actually retired.
    input.once("close", () => input.off("error", this.onError));
    output.once("close", () => output.off("error", this.onError));
  }

  /** Send an explicitly addressed command with a bounded reply lifetime. */
  public send<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    options: { sessionId?: string; signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<T> {
    const { signal, sessionId, timeoutMs = 15_000 } = options;
    if (this.closedError) return Promise.reject(this.closedError);
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return Promise.reject(new Error("CDP timeout must be positive and finite"));
    }
    if (this.pending.size >= MAX_PENDING_COMMANDS || this.output.writableNeedDrain) {
      return Promise.reject(new Error("Chromium command capacity exceeded"));
    }

    const id = ++this.nextId;
    let encoded: string;
    try {
      encoded = JSON.stringify({ id, method, params, sessionId }) + "\0";
    } catch (error) {
      return Promise.reject(error);
    }
    if (Buffer.byteLength(encoded) > MAX_MESSAGE_BYTES) {
      return Promise.reject(new Error("Chromium command exceeds the pipe byte limit"));
    }

    return new Promise<T>((resolve, reject) => {
      const abandon = (error: Error) => {
        const command = this.pending.get(id);
        if (!command) return;
        this.pending.delete(id);
        command.dispose();
        reject(error);
      };
      const abort = () => abandon(signal?.reason ?? new Error("CDP command cancelled"));
      const timer = setTimeout(
        () => abandon(new Error(`Chromium ${method} timed out; outcome may be unknown`)),
        timeoutMs,
      );
      timer.unref();
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        dispose: () => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
        },
      });
      signal?.addEventListener("abort", abort, { once: true });
      try {
        this.output.write(encoded, (error) => {
          if (error) this.close(error);
        });
      } catch (error) {
        this.close(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /** Reject outstanding replies and detach only this transport's listeners. */
  public close(error = new Error("Chromium pipe closed")): void {
    if (this.closedError) return;
    this.closedError = error;
    this.input.off("data", this.receive);
    this.input.off("end", this.onEnd);
    for (const command of this.pending.values()) {
      command.dispose();
      command.reject(error);
    }
    this.pending.clear();
    this.fragments = [];
    this.fragmentBytes = 0;
    this.input.destroy();
    this.output.destroy();
    this.emit("closed", error);
  }

  private readonly onEnd = () => this.close();
  private readonly onError = (error: Error) => this.close(error);

  /** Parse byte-delimited messages before decoding, preserving split UTF-8. */
  private readonly receive = (chunk: Buffer) => {
    let start = 0;
    while (start < chunk.length && !this.closedError) {
      const delimiter = chunk.indexOf(0, start);
      const end = delimiter < 0 ? chunk.length : delimiter;
      const fragment = chunk.subarray(start, end);
      this.fragmentBytes += fragment.length;
      if (this.fragmentBytes > MAX_MESSAGE_BYTES) {
        this.close(new Error("Chromium reply exceeds the pipe byte limit"));
        return;
      }
      this.fragments.push(fragment);
      if (delimiter < 0) return;
      const message = Buffer.concat(this.fragments, this.fragmentBytes).toString("utf8");
      this.fragments = [];
      this.fragmentBytes = 0;
      start = delimiter + 1;
      if (!message) continue;
      try {
        const reply = JSON.parse(message);
        if (typeof reply.id === "number") {
          const command = this.pending.get(reply.id);
          if (!command) continue;
          this.pending.delete(reply.id);
          command.dispose();
          if (reply.error) {
            command.reject(new Error(`Chromium: ${reply.error.message}`));
          } else {
            command.resolve(reply.result);
          }
        } else if (typeof reply.method === "string") {
          this.emit("event", reply as CdpEvent);
        }
      } catch (error) {
        this.close(error instanceof Error ? error : new Error(String(error)));
      }
    }
  };
}
