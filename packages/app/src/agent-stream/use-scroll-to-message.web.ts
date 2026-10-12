import type React from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { Virtualizer } from "@tanstack/react-virtual";
import { useStableEvent } from "@/hooks/use-stable-event";
import type { StreamItem } from "@/types/stream";
import { getStreamItemMessageId } from "./presentation";
import { createPromptJumpSettleController, PROMPT_JUMP_TOP_INSET_PX } from "./prompt-jump-settle";
import type { ScrollToMessageOccurrence } from "./strategy";

interface UseScrollToMessageInput {
  active: boolean;
  scrollContainerRef: React.RefObject<HTMLElement | null>;
  rowVirtualizer: Virtualizer<HTMLElement, Element>;
  historyVirtualized: readonly StreamItem[];
  cancelPendingStickToBottom: () => void;
  setFollowOutput: (value: boolean) => boolean;
  onNearBottomChange: (value: boolean) => void;
  onSettled: () => void;
  onStarted: () => void;
}

const SCROLL_AFFECTING_KEYS = new Set([
  "ArrowDown",
  "ArrowUp",
  "End",
  "Home",
  "PageDown",
  "PageUp",
  " ",
]);

export function useScrollToMessage({
  active,
  scrollContainerRef,
  rowVirtualizer,
  historyVirtualized,
  cancelPendingStickToBottom,
  setFollowOutput,
  onNearBottomChange,
  onSettled,
  onStarted,
}: UseScrollToMessageInput) {
  const occurrenceRef = useRef<ScrollToMessageOccurrence | undefined>(undefined);
  const removeAbortListener = useRef<(() => void) | null>(null);
  const settled = useStableEvent(onSettled);
  const started = useStableEvent(onStarted);
  const estimateTargetTop = useStableEvent((messageId: string): number | null => {
    const container = scrollContainerRef.current;
    const index = historyVirtualized.findIndex(
      (item) => getStreamItemMessageId(item) === messageId,
    );
    const offset = index >= 0 ? rowVirtualizer.getOffsetForIndex(index, "start")?.[0] : undefined;
    return container && offset !== undefined
      ? container.getBoundingClientRect().top +
          offset -
          container.scrollTop +
          PROMPT_JUMP_TOP_INSET_PX
      : null;
  });
  const settleController = useMemo(
    () =>
      createPromptJumpSettleController({
        viewport: {
          findTargetTop(messageId) {
            const occurrence = occurrenceRef.current;
            if (occurrence?.signal.aborted) return null;
            if (occurrence) return occurrence.targetTop();
            // Every row of an assistant message carries the message id; the first one
            // is the message's top.
            const target = scrollContainerRef.current?.querySelector<HTMLElement>(
              `[data-message-id="${CSS.escape(messageId)}"]`,
            );
            return target ? target.getBoundingClientRect().top : estimateTargetTop(messageId);
          },
          getContainerTop() {
            return scrollContainerRef.current?.getBoundingClientRect().top ?? 0;
          },
          getScrollMetrics() {
            const container = scrollContainerRef.current;
            return {
              clientHeight: container?.clientHeight ?? 0,
              scrollHeight: container?.scrollHeight ?? 0,
              scrollTop: container?.scrollTop ?? 0,
            };
          },
          setScrollTop(scrollTop) {
            const container = scrollContainerRef.current;
            if (container) container.scrollTop = scrollTop;
          },
          subscribeToUserIntent(listener) {
            const container = scrollContainerRef.current;
            if (!container) return () => undefined;
            const handleKeyDown = (event: KeyboardEvent) => {
              if (SCROLL_AFFECTING_KEYS.has(event.key)) listener();
            };
            container.addEventListener("wheel", listener, { passive: true });
            container.addEventListener("touchstart", listener, { passive: true });
            container.addEventListener("keydown", handleKeyDown, { passive: true });
            return () => {
              container.removeEventListener("wheel", listener);
              container.removeEventListener("touchstart", listener);
              container.removeEventListener("keydown", handleKeyDown);
            };
          },
        },
        requestFrame: (callback) => window.requestAnimationFrame(callback),
        cancelFrame: (frameId) => window.cancelAnimationFrame(frameId),
        onFinished: settled,
      }),
    [scrollContainerRef, estimateTargetTop, settled],
  );

  useEffect(
    () => () => {
      removeAbortListener.current?.();
      settleController.cancel();
    },
    [settleController],
  );
  useLayoutEffect(() => {
    if (!active) {
      settleController.cancel();
    }
  }, [active, settleController]);

  const scrollToMessage = useCallback(
    (messageId: string, occurrence?: ScrollToMessageOccurrence) => {
      occurrenceRef.current = occurrence;
      removeAbortListener.current?.();
      const cancel = () => settleController.cancel();
      occurrence?.signal.addEventListener("abort", cancel, { once: true });
      removeAbortListener.current = () => occurrence?.signal.removeEventListener("abort", cancel);
      if (!active) return;
      const container = scrollContainerRef.current;
      if (!container) return;
      cancelPendingStickToBottom();
      setFollowOutput(false);

      started();
      settleController.start(messageId, {
        smooth: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      });
      onNearBottomChange(false);
    },
    [
      active,
      cancelPendingStickToBottom,
      onNearBottomChange,
      scrollContainerRef,
      settleController,
      setFollowOutput,
      started,
    ],
  );

  const cancelScrollToMessage = useCallback(() => {
    removeAbortListener.current?.();
    removeAbortListener.current = null;
    occurrenceRef.current = undefined;
    settleController.cancel();
  }, [settleController]);

  return {
    cancelScrollToMessage,
    isJumpSettling: settleController.isActive,
    scrollToMessage,
  };
}
