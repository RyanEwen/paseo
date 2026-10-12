interface PromptJumpScrollMetrics {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
}

export interface PromptJumpSettleViewport {
  findTargetTop(messageId: string): number | null;
  getContainerTop(): number;
  getScrollMetrics(): PromptJumpScrollMetrics;
  setScrollTop(scrollTop: number): void;
  subscribeToUserIntent(listener: () => void): () => void;
}

export interface PromptJumpSettleController {
  start(messageId: string, options?: { smooth?: boolean }): void;
  cancel(): void;
  isActive(): boolean;
}

const POSITION_TOLERANCE_PX = 1;
const REQUIRED_STABLE_FRAMES = 2;
const FRAME_BUDGET = 24;
export const PROMPT_JUMP_TOP_INSET_PX = 8;

function distanceFromLandingPosition(targetTop: number, containerTop: number): number {
  return targetTop - containerTop - PROMPT_JUMP_TOP_INSET_PX;
}

export function createPromptJumpSettleController(input: {
  viewport: PromptJumpSettleViewport;
  requestFrame: (callback: () => void) => number;
  cancelFrame: (frameId: number) => void;
  now?: () => number;
  onFinished?: () => void;
}): PromptJumpSettleController {
  let activeMessageId: string | null = null;
  let startedAt = 0;
  let smooth = false;
  let previousEase = 0;
  let frameId: number | null = null;
  let sampledFrames = 0;
  let stableFrames = 0;
  let unsubscribeFromUserIntent: (() => void) | null = null;

  function finish(): void {
    const wasActive = activeMessageId !== null;
    if (frameId !== null) input.cancelFrame(frameId);
    unsubscribeFromUserIntent?.();
    activeMessageId = null;
    frameId = null;
    sampledFrames = 0;
    stableFrames = 0;
    unsubscribeFromUserIntent = null;
    if (wasActive) input.onFinished?.();
  }

  function scheduleNextFrame(): void {
    frameId = input.requestFrame(tick);
  }

  function tick(): void {
    frameId = null;
    const messageId = activeMessageId;
    if (messageId === null) return;

    sampledFrames += 1;
    const targetTop = input.viewport.findTargetTop(messageId);
    if (targetTop !== null) {
      const delta = distanceFromLandingPosition(targetTop, input.viewport.getContainerTop());
      if (Math.abs(delta) <= POSITION_TOLERANCE_PX) {
        stableFrames += 1;
        if (stableFrames >= REQUIRED_STABLE_FRAMES) {
          finish();
          return;
        }
      } else {
        stableFrames = 0;
        const before = input.viewport.getScrollMetrics();
        const progress = smooth
          ? Math.min(1, ((input.now?.() ?? performance.now()) - startedAt) / 240)
          : 1;
        const ease = 1 - (1 - progress) ** 3;
        const fraction = previousEase >= 1 ? 1 : (ease - previousEase) / (1 - previousEase);
        previousEase = ease;
        input.viewport.setScrollTop(before.scrollTop + delta * fraction);
        const after = input.viewport.getScrollMetrics();
        const adjustedTargetTop = input.viewport.findTargetTop(messageId);
        let remainingDelta = 0;
        if (adjustedTargetTop !== null) {
          remainingDelta = distanceFromLandingPosition(
            adjustedTargetTop,
            input.viewport.getContainerTop(),
          );
        }
        const maxScrollTop = Math.max(0, after.scrollHeight - after.clientHeight);
        const isClampedAtBottom = after.scrollTop >= maxScrollTop - POSITION_TOLERANCE_PX;
        if (remainingDelta > POSITION_TOLERANCE_PX && isClampedAtBottom) {
          finish();
          return;
        }
      }
    }

    if (sampledFrames >= FRAME_BUDGET) {
      finish();
      return;
    }
    scheduleNextFrame();
  }

  return {
    start(messageId, options) {
      finish();
      smooth = options?.smooth === true;
      previousEase = 0;
      startedAt = input.now?.() ?? performance.now();
      activeMessageId = messageId;
      unsubscribeFromUserIntent = input.viewport.subscribeToUserIntent(finish);
      scheduleNextFrame();
    },
    cancel: finish,
    isActive() {
      return activeMessageId !== null;
    },
  };
}
