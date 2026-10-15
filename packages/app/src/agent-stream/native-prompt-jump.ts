import { resolvePromptJumpInset, type PromptJumpPlacement } from "./prompt-jump-placement";

export interface NativePromptIndexFailure {
  index: number;
  averageItemLength: number;
  highestMeasuredFrameIndex: number;
}

export interface NativePromptJumpViewport {
  findHistoryIndex(messageId: string): number;
  findLiveOffset(messageId: string): number | undefined;
  getLiveHeaderHeight(): number | null;
  /** Measure upright bubble top relative to the viewport and current inverted scroll extent. */
  measureTarget(
    messageId: string,
    callback: (position: NativePromptJumpPosition | null) => void,
  ): void;
  scrollToIndex(index: number): void;
  scrollToOffset(offset: number, animated: boolean): void;
}

export interface NativePromptJumpPosition {
  top: number;
  offset: number;
  maxOffset: number;
}

const ATTEMPT_BUDGET = 8;
const STALLED_ATTEMPT_BUDGET = 3;
const RECOVERY_TIME_BUDGET_MS = 2000;

/** Resolve a stable message ID against FlatList's current rows. FlatList reports an
 * unmeasured index synchronously. Recovery mounts its estimated cell using the measured
 * header extent, then retries exact index scrolling and verifies the measured landing.
 * Attempts never reset their own budget.
 * A bounded failure reports through the viewport owner rather than silently landing nearby.
 */
export function createNativePromptJumpController(input: {
  viewport: NativePromptJumpViewport;
  scheduleRetry(callback: () => void): () => void;
  now(): number;
  onFailure(messageId: string): void;
}) {
  let operation: {
    messageId: string;
    placement: PromptJumpPlacement;
    startedAt: number;
    attempts: number;
    stalled: number;
    progressKey: string | null;
    failed: boolean;
    stable: number;
    cancelRetry: (() => void) | null;
  } | null = null;

  function cancel(): void {
    operation?.cancelRetry?.();
    operation = null;
  }

  function fail(): void {
    const id = operation?.messageId;
    cancel();
    if (id) input.onFailure(id);
  }

  function attempt(): void {
    const current = operation;
    if (!current) return;
    current.cancelRetry = null;
    if (
      current.attempts >= ATTEMPT_BUDGET ||
      input.now() - current.startedAt >= RECOVERY_TIME_BUDGET_MS
    ) {
      fail();
      return;
    }
    current.attempts += 1;
    current.failed = false;
    const index = input.viewport.findHistoryIndex(current.messageId);
    if (index < 0) {
      const offset = input.viewport.findLiveOffset(current.messageId);
      if (offset === undefined) fail();
      else {
        input.viewport.scrollToOffset(offset, true);
        scheduleVerification(current);
      }
      return;
    }
    try {
      input.viewport.scrollToIndex(index);
      if (operation === current && !current.failed) scheduleVerification(current);
    } catch {
      if (operation === current) fail();
    }
  }

  /** Accepted index commands can still use stale cell frames. Verify two measured
   * landings, correcting the inverted offset only after the target actually mounts.
   */
  function scheduleVerification(current: NonNullable<typeof operation>): void {
    current.cancelRetry = input.scheduleRetry(() => {
      if (operation !== current) return;
      current.cancelRetry = null;
      if (
        current.attempts >= ATTEMPT_BUDGET ||
        input.now() - current.startedAt >= RECOVERY_TIME_BUDGET_MS
      ) {
        fail();
        return;
      }
      current.attempts += 1;
      const measurementAttempt = current.attempts;
      // A native node can disappear without delivering its measurement callback.
      // Keep the same bounded timer alive and ignore measurements from older attempts.
      scheduleVerification(current);
      input.viewport.measureTarget(current.messageId, (position) => {
        if (operation !== current || current.attempts !== measurementAttempt) return;
        current.cancelRetry?.();
        current.cancelRetry = null;
        if (!position) {
          current.stable = 0;
          attempt();
          return;
        }
        // Increasing an inverted FlatList offset moves upright content downwards.
        const destination = Math.min(
          position.maxOffset,
          Math.max(0, position.offset + resolvePromptJumpInset(current.placement) - position.top),
        );
        if (Math.abs(destination - position.offset) <= 1) {
          current.stable += 1;
          if (current.stable >= 2) {
            cancel();
            return;
          }
        } else {
          current.stable = 0;
          input.viewport.scrollToOffset(destination, false);
        }
        scheduleVerification(current);
      });
    });
  }

  function handleIndexFailure(failure: NativePromptIndexFailure): void {
    const current = operation;
    if (!current || failure.index !== input.viewport.findHistoryIndex(current.messageId)) return;
    current.failed = true;
    const headerHeight = input.viewport.getLiveHeaderHeight();
    const average = Math.max(0, failure.averageItemLength);
    const progressKey = `${failure.index}:${failure.highestMeasuredFrameIndex}:${headerHeight}:${average}`;
    current.stalled = current.progressKey === progressKey ? current.stalled + 1 : 0;
    current.progressKey = progressKey;
    if (current.stalled >= STALLED_ATTEMPT_BUDGET || current.attempts >= ATTEMPT_BUDGET) {
      fail();
      return;
    }
    // An unmeasured header is not zero. Wait for layout rather than scrolling into
    // a long live response using an estimate that assumes history begins at the origin.
    if (headerHeight !== null)
      input.viewport.scrollToOffset(headerHeight + average * failure.index, false);
    current.cancelRetry?.();
    current.cancelRetry = input.scheduleRetry(() => {
      if (operation === current) attempt();
    });
  }

  return {
    start(messageId: string, placement: PromptJumpPlacement = "original") {
      cancel();
      operation = {
        messageId,
        placement,
        startedAt: input.now(),
        attempts: 0,
        stalled: 0,
        progressKey: null,
        failed: false,
        stable: 0,
        cancelRetry: null,
      };
      attempt();
    },
    cancel,
    handleIndexFailure,
    isActive: () => operation !== null,
  };
}
