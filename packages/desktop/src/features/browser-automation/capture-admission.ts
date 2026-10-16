// Best-effort capture geometry checks and enforced queue limits, independent of optional policies.
// Electron/CDP do not expose an atomic geometry snapshot or native allocation budget.
export const CAPTURE_MAX_AXIS = 8192;
export const CAPTURE_MAX_PIXELS = 8_000_000;
export const CAPTURE_MAX_BYTES = 16 * 1024 * 1024;
export const CAPTURE_MAX_PENDING = 4;
export const CAPTURE_TIMEOUT_MS = 5_000;

export class CaptureAdmissionError extends Error {
  constructor(
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "CaptureAdmissionError";
  }
}

export function assertCaptureGeometry(width: number, height: number, scale: number): void {
  const dimensions = [width, height, scale];
  if (!dimensions.every((value) => Number.isFinite(value) && value > 0)) {
    throw new CaptureAdmissionError(
      "Screenshot dimensions and device scale must be finite and positive.",
    );
  }
  const physicalWidth = Math.ceil(width * Math.max(1, scale));
  const physicalHeight = Math.ceil(height * Math.max(1, scale));
  if (
    physicalWidth > CAPTURE_MAX_AXIS ||
    physicalHeight > CAPTURE_MAX_AXIS ||
    physicalWidth * physicalHeight > CAPTURE_MAX_PIXELS
  ) {
    throw new CaptureAdmissionError(
      "Screenshot exceeds 8192 pixels per axis or 8 million physical pixels. Request a smaller viewport or page.",
    );
  }
}

interface PendingCapture {
  start(): void;
}

/** One host-wide capture concurrency owner. Cancellation removes waiters, but a dispatched
 * Electron/CDP capture owns its slot until the actual operation settles.
 */
export class CaptureAdmission {
  private active = false;
  private readonly pending: PendingCapture[] = [];

  run<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    if (this.active && this.pending.length >= CAPTURE_MAX_PENDING) {
      throw new CaptureAdmissionError(
        "Screenshot queue is full. Retry after the current captures finish.",
        true,
      );
    }
    return new Promise<T>((resolve, reject) => {
      const abort = () => {
        const index = this.pending.indexOf(entry);
        if (index >= 0) this.pending.splice(index, 1);
        signal.removeEventListener("abort", abort);
        reject(signal.reason);
      };
      const entry: PendingCapture = {
        start: () => {
          signal.removeEventListener("abort", abort);
          this.active = true;
          const operation = Promise.resolve().then(() => {
            signal.throwIfAborted();
            return task();
          });
          void operation.then(resolve, reject).finally(() => {
            this.active = false;
            this.pending.shift()?.start();
          });
        },
      };
      if (this.active) {
        this.pending.push(entry);
        signal.addEventListener("abort", abort, { once: true });
      } else {
        entry.start();
      }
    });
  }
}
