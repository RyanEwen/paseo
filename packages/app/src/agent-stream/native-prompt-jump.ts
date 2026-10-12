export interface NativePromptIndexFailure {
  index: number;
  averageItemLength: number;
  highestMeasuredFrameIndex: number;
}

export interface NativePromptJumpViewport {
  findHistoryIndex(messageId: string): number;
  findLiveOffset(messageId: string): number | undefined;
  getLiveHeaderHeight(): number | null;
  scrollToIndex(index: number): void;
  scrollToOffset(offset: number, animated: boolean): void;
}

const ATTEMPT_BUDGET = 8;
const STALLED_ATTEMPT_BUDGET = 3;
const RECOVERY_TIME_BUDGET_MS = 2000;

/** Resolve a stable message ID against FlatList's current rows. FlatList reports an
 * unmeasured index synchronously. Recovery mounts its estimated cell using the measured
 * header extent, then retries exact index scrolling. Attempts never reset their own budget.
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
    startedAt: number;
    attempts: number;
    stalled: number;
    progressKey: string | null;
    failed: boolean;
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
        cancel();
      }
      return;
    }
    try {
      input.viewport.scrollToIndex(index);
      if (operation === current && !current.failed) cancel();
    } catch {
      if (operation === current) fail();
    }
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
    start(messageId: string) {
      cancel();
      operation = {
        messageId,
        startedAt: input.now(),
        attempts: 0,
        stalled: 0,
        progressKey: null,
        failed: false,
        cancelRetry: null,
      };
      attempt();
    },
    cancel,
    handleIndexFailure,
    isActive: () => operation !== null,
  };
}
