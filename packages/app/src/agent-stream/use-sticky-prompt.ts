import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useStableEvent } from "@/hooks/use-stable-event";
import type { TimelinePageAcceptance } from "@/timeline/fetch-viewed-timeline-page";
import { EMPTY_PROMPT_READING_SOURCE, type PromptReadingSource } from "./prompt-reading-position";
import { useReadingPrompt } from "./use-reading-prompt";
import { usePromptDiscovery } from "./use-prompt-discovery";
import type { StreamItem } from "@/types/stream";
import type { ChatOutline } from "./chat-outline/use-chat-outline";
import {
  buildPromptTargets,
  resolveReadingPromptTarget,
  getMissingReadingPromptSeq,
  isStickyPromptVisible,
  shouldDiscoverPrompt,
  needsReadingPromptDiscovery,
  hasDiscoveredPrompt,
  resolveStickyPromptMessage,
  isNextPromptDisabled,
  findPromptTarget,
  isPromptNavigationBusy,
  isPreviousPromptDisabled,
  type PromptTarget,
  type UserPrompt,
} from "./sticky-prompt-model";

interface Input {
  reading?: PromptReadingSource;
  fetchPrompt?: (seq: number) => Promise<UserPrompt>;
  items: StreamItem[];
  epoch: string | null;
  outline: ChatOutline;
  indexed: boolean;
  hasOlder: boolean;
  loadingOlder: boolean;
  progressKey: string | null;
  loadOlder: (acceptance?: TimelinePageAcceptance) => boolean | Promise<boolean>;
  jumpToLoaded: (id: string) => void;
}

/** Own the sticky selection while the existing timeline owner loads and scrolls prompts. */
export function useStickyPrompt(input: Input) {
  const {
    items,
    epoch,
    outline,
    indexed,
    hasOlder,
    loadingOlder,
    progressKey,
    loadOlder,
    jumpToLoaded,
  } = input;
  const readingSource = input.reading ?? EMPTY_PROMPT_READING_SOURCE;
  const reading = useSyncExternalStore(
    readingSource.subscribe,
    readingSource.getSnapshot,
    readingSource.getSnapshot,
  );
  const targets = useMemo(
    () => buildPromptTargets(items, outline.prompts, epoch),
    [items, outline.prompts, epoch],
  );
  const [selected, setSelected] = useState<UserPrompt | null>(null);
  const [pending, setPending] = useState<PromptTarget | "previous" | null>(null);
  const [error, setError] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const retryTarget = useRef<{ target: PromptTarget; scroll: boolean } | null>(null);
  const retryDirection = useRef<-1 | 1>(-1);
  const latest = targets.at(-1)?.item;
  const selectedMessage = selected ?? latest;

  // The reading row is authoritative for manual scrolling. Keep full selected content
  // across page replacements, and never replace an explicit pending navigation.
  const readingTarget = useMemo(
    () =>
      reading.following
        ? targets.at(-1)
        : resolveReadingPromptTarget(items, targets, reading.rowId, reading.seq),
    [items, reading.rowId, reading.seq, reading.following, targets],
  );
  const discoverReading = needsReadingPromptDiscovery(
    indexed,
    reading.manual,
    reading.rowId,
    readingTarget,
  );
  const missingReadingSeq = getMissingReadingPromptSeq({
    navigating: reading.navigating,
    intentional: reading.manual || reading.following,
    pending: pending !== null || outline.isJumping,
    target: readingTarget,
    latest: targets.at(-1),
    selected: selectedMessage,
  });
  const knownPrompts = useMemo(
    () => items.filter((item): item is UserPrompt => item.kind === "user_message"),
    [items],
  );
  const readingContent = useReadingPrompt({
    knownPrompts,
    seq: missingReadingSeq,
    fetchPrompt: input.fetchPrompt,
  });
  const readingItem = readingTarget?.item ?? readingContent.item;
  const message = resolveStickyPromptMessage(
    selectedMessage,
    readingContent.item,
    discoverReading,
    missingReadingSeq,
    input.fetchPrompt !== undefined,
  );
  const position = message ? findPromptTarget(targets, message) : -1;
  useEffect(() => {
    if (
      (!reading.manual && !reading.following) ||
      reading.navigating ||
      pending ||
      outline.isJumping ||
      !readingItem
    )
      return;
    setSelected(readingTarget?.key === targets.at(-1)?.key ? null : readingItem);
  }, [
    reading.manual,
    reading.following,
    reading.navigating,
    outline.isJumping,
    pending,
    readingTarget,
    readingItem,
    targets,
  ]);

  const previous = targets[position - 1];
  const discoveringPrevious = pending === "previous";
  const discovery = usePromptDiscovery({
    enabled: shouldDiscoverPrompt(
      discoveringPrevious,
      indexed,
      message,
      cancelled,
      discoverReading,
    ),
    reached: hasDiscoveredPrompt(
      discoveringPrevious,
      previous,
      discoverReading,
      readingTarget,
      message,
    ),
    hasOlder,
    loadingOlder,
    progressKey: progressKey ?? items[0]?.id ?? "empty",
    loadOlder,
  });

  const selectTarget = useStableEvent((target: PromptTarget, scroll: boolean = true) => {
    setError(false);
    retryTarget.current = { target, scroll };
    if (target.item) {
      setSelected(target.key === targets.at(-1)?.key ? null : target.item);
      setPending(null);
      if (scroll) jumpToLoaded(target.item.id);
    } else if (target.seq !== undefined) {
      setPending(target);
      outline.jumpToPrompt(target.seq, { scroll });
    }
  });

  useEffect(() => {
    if (!pending || pending === "previous") return;
    const loaded = targets.find((target) => target.key === pending.key);
    if (loaded?.item) {
      setSelected(loaded.key === targets.at(-1)?.key ? null : loaded.item);
      setPending(null);
    } else if (outline.jumpError) {
      setError(true);
      setPending(null);
    }
  }, [outline.jumpError, pending, targets]);

  useEffect(() => {
    const newest = targets.at(-1);
    if (
      indexed &&
      !selectedMessage &&
      newest &&
      !pending &&
      !cancelled &&
      !error &&
      !outline.jumpError
    )
      selectTarget(newest, false);
  }, [
    cancelled,
    error,
    indexed,
    selectedMessage,
    outline.jumpError,
    pending,
    selectTarget,
    targets,
  ]);

  useEffect(() => {
    if (!discoveringPrevious) return;
    if (previous) selectTarget(previous);
    else if (["error", "limited", "exhausted", "cancelled"].includes(discovery.status))
      setPending(null);
  }, [discoveringPrevious, discovery.status, previous, selectTarget]);

  const navigate = useStableEvent((direction: -1 | 1) => {
    if (!message) return;
    discovery.restart();
    retryTarget.current = null;
    setCancelled(false);
    retryDirection.current = direction;
    // Freeze the current prompt before a remote jump replaces the loaded window.
    setSelected(message);
    const target = targets[position + direction];
    if (target) selectTarget(target);
    else if (direction === -1 && hasOlder) setPending("previous");
  });

  const cancel = useStableEvent(() => {
    outline.cancelJump();
    readingContent.cancel();
    retryTarget.current = null;
    discovery.cancel();
    setPending(null);
    setError(false);
    setCancelled(true);
  });
  const reviewReading = useStableEvent(() => {
    outline.cancelJump();
    readingContent.cancel();
    discovery.restart();
    retryTarget.current = null;
    setPending(null);
    setError(false);
    setCancelled(false);
  });
  const followLatest = useStableEvent(() => {
    cancel();
    setSelected(null);
  });
  const retry = useStableEvent(() => {
    if (readingContent.error) {
      readingContent.retry();
      return;
    }
    setCancelled(false);
    setError(false);
    discovery.restart();
    if (outline.indexError) {
      outline.retryIndex();
      return;
    }
    const previousAttempt = retryTarget.current;
    if (previousAttempt) {
      const target =
        targets.find((entry) => entry.key === previousAttempt.target.key) ?? previousAttempt.target;
      selectTarget(target, previousAttempt.scroll);
    } else if (message) navigate(retryDirection.current);
    else if (indexed) {
      const newest = targets.at(-1);
      if (newest) selectTarget(newest, false);
      else outline.retryIndex();
    }
  });

  const previousAction = useStableEvent(() => navigate(-1));
  const nextAction = useStableEvent(() => navigate(1));
  const activate = useStableEvent((id: string, direction: -1 | 1) => {
    const current = targets.findIndex((target) => target.item?.id === id);
    const item = targets[current]?.item;
    if (!item) return;
    setSelected(item);
    discovery.restart();
    setCancelled(false);
    retryDirection.current = direction;
    const target = targets[current + direction];
    if (target) selectTarget(target);
    else if (direction === -1 && hasOlder) setPending("previous");
  });
  return {
    message,
    targets,
    previousKnownBoundary: indexed ? outline.indexReady : !hasOlder,
    activate,
    stickyVisible: isStickyPromptVisible(
      message,
      readingTarget,
      reading.visibleUserIds,
      reading.rowId,
    ),
    discoveryStatus: discovery.status,
    cancelled,
    busy: isPromptNavigationBusy({
      pending: pending !== null || readingContent.loading,
      jumping: outline.isJumping,
      discovering: discovery.status === "loading",
      indexed,
      epoch,
      cancelled,
      indexReady: outline.indexReady,
      indexError: outline.indexError,
    }),
    error: [
      error,
      outline.indexError,
      outline.jumpError,
      discovery.status === "error",
      readingContent.error,
    ].some(Boolean),
    previousDisabled: isPreviousPromptDisabled({
      message,
      indexed,
      position,
      hasOlder,
      indexReady: outline.indexReady,
      indexError: outline.indexError,
    }),
    nextDisabled: isNextPromptDisabled(message, position, targets.length),
    retry,
    cancel,
    previous: previousAction,
    next: nextAction,
    followLatest,
    reviewReading,
  };
}
