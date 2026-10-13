import { useLayoutEffect, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useStableEvent } from "@/hooks/use-stable-event";
import type { TimelinePageAcceptance } from "@/timeline/fetch-viewed-timeline-page";
import {
  EMPTY_PROMPT_READING_SOURCE,
  type PromptReadingSource,
  type PromptReadingPosition,
} from "./prompt-reading-position";
import { useReadingPrompt } from "./use-reading-prompt";
import { usePromptDiscovery } from "./use-prompt-discovery";
import type { StreamItem } from "@/types/stream";
import type { ChatOutline } from "./chat-outline/use-chat-outline";
import {
  buildPromptTargets,
  resolveContextSource,
  isContextSourceMissing,
  mergeCachedPromptTarget,
  resolveReadingPromptTarget,
  getMissingReadingPromptSeq,
  isStickyPromptVisible,
  resolveStickyReadingTarget,
  resolveStickyPromptProgress,
  resolvePromptOcclusionTop,
  resolvePromptGeometry,
  shouldReadContext,
  resolveContextMessage,
  shouldDiscoverCachedPrompt,
  hasDiscoveredCachedPrompt,
  needsReadingPromptDiscovery,
  isNextPromptDisabled,
  findPromptTarget,
  isPromptNavigationBusy,
  isPreviousPromptDisabled,
  type PromptTarget,
  type UserPrompt,
} from "./sticky-prompt-model";

interface Input {
  enabled?: boolean;
  reading?: PromptReadingSource;
  fetchPrompt?: (seq: number) => Promise<UserPrompt>;
  fetchContext?: (source: StreamItem, signal: AbortSignal) => Promise<UserPrompt | undefined>;
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
    enabled = true,
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
  const readingSource = enabled
    ? (input.reading ?? EMPTY_PROMPT_READING_SOURCE)
    : EMPTY_PROMPT_READING_SOURCE;
  const reading = useSyncExternalStore(
    readingSource.subscribe,
    readingSource.getSnapshot,
    readingSource.getSnapshot,
  );
  const loadedTargets = useMemo(
    () => buildPromptTargets(items, outline.prompts, epoch),
    [items, outline.prompts, epoch],
  );
  const ownerEpoch = useRef(epoch);
  const scopeChanged = ownerEpoch.current !== epoch;
  const [storedSelected, setSelected] = useState<UserPrompt | null>(null);
  const [storedPending, setPending] = useState<PromptTarget | "previous" | null>(null);
  const [storedError, setError] = useState(false);
  const [storedCancelled, setCancelled] = useState(false);
  // Do not expose old prompt state during the first render of a new epoch.
  const { selected, pending, error, cancelled } = resolveEpochPromptState(scopeChanged, {
    selected: storedSelected,
    pending: storedPending,
    error: storedError,
    cancelled: storedCancelled,
  });
  const retryTarget = useRef<{
    target: PromptTarget;
    scroll: boolean;
    preserveSelection?: boolean;
  } | null>(null);
  const retryDirection = useRef<-1 | 1>(-1);
  const latest = loadedTargets.at(-1)?.item;
  const selectedMessage = selected ?? latest;

  // The reading row is authoritative for manual scrolling. Keep full selected content
  // across page replacements, and never replace an explicit pending navigation.
  const readingTarget = useMemo(
    () =>
      reading.following
        ? loadedTargets.at(-1)
        : resolveReadingPromptTarget(items, loadedTargets, reading.rowId, reading.seq),
    [items, reading.rowId, reading.seq, reading.following, loadedTargets],
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
    indexed,
    cancelled,
    pending: pending !== null || outline.isJumping,
    target: readingTarget,
    latest: loadedTargets.at(-1),
    selected: selectedMessage,
  });
  const knownPrompts = useMemo(
    () => items.filter((item): item is UserPrompt => item.kind === "user_message"),
    [items],
  );
  const contextRequested = shouldReadContext(
    enabled,
    discoverReading,
    cancelled,
    reading.navigating,
    pending,
  );
  const contextSource = resolveContextSource(
    items,
    epoch,
    reading.rowId,
    reading.seq,
    contextRequested,
  );
  const readingContent = useReadingPrompt({
    knownPrompts,
    epoch,
    seq: enabled ? missingReadingSeq : undefined,
    fetchPrompt: input.fetchPrompt,
    source: contextSource,
    fetchContext: input.fetchContext,
  });
  const targets = useMemo(
    () => mergeCachedPromptTarget(loadedTargets, readingContent.item, selected, epoch),
    [loadedTargets, readingContent.item, selected, epoch],
  );
  const readingItem = readingTarget?.item ?? readingContent.item;
  const message = resolveContextMessage(
    pending,
    discoverReading,
    selectedMessage,
    readingContent.item,
    missingReadingSeq,
    input.fetchPrompt !== undefined,
  );
  const position = message ? findPromptTarget(targets, message) : -1;
  useEffect(() => {
    if (
      !enabled ||
      (!reading.manual && !reading.following) ||
      reading.navigating ||
      pending ||
      outline.isJumping ||
      !readingItem
    )
      return;
    setSelected(readingTarget?.key === targets.at(-1)?.key ? null : readingItem);
  }, [
    enabled,
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
    enabled:
      enabled && shouldDiscoverCachedPrompt(pending, indexed, message, cancelled, discoverReading),
    reached: hasDiscoveredCachedPrompt(
      pending,
      loadedTargets,
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

  const selectTarget = useStableEvent(
    (target: PromptTarget, scroll: boolean = true, options?: { preserveSelection?: boolean }) => {
      if (!enabled) return;
      setError(false);
      retryTarget.current = { target, scroll, preserveSelection: options?.preserveSelection };
      if (target.item && !target.cached) {
        setSelected(
          !options?.preserveSelection && target.key === targets.at(-1)?.key ? null : target.item,
        );
        setPending(null);
        if (scroll) jumpToLoaded(target.item.id);
      } else if (target.seq !== undefined) {
        setPending(target);
        if (indexed) outline.jumpToPrompt(target.seq, { scroll, source: "sticky" });
      }
    },
  );

  useEffect(() => {
    if (!enabled || !pending || pending === "previous") return;
    const loaded = loadedTargets.find((target) => target.key === pending.key);
    if (loaded?.item) {
      const preserveSelection =
        retryTarget.current?.target.key === loaded.key && retryTarget.current.preserveSelection;
      setSelected(!preserveSelection && loaded.key === targets.at(-1)?.key ? null : loaded.item);
      setPending(null);
      if (pending.cached && retryTarget.current?.scroll) jumpToLoaded(loaded.item.id);
    } else if (
      outline.jumpError ||
      (pending.cached && ["error", "limited", "exhausted"].includes(discovery.status))
    ) {
      setError(true);
      setPending(null);
    }
  }, [enabled, outline.jumpError, pending, loadedTargets, discovery.status, jumpToLoaded, targets]);

  // Initial/latest display is a content lookup, never an implicit prompt jump.
  // Only an explicit navigation below may replace the authoritative history window.

  useEffect(() => {
    if (!enabled || !discoveringPrevious) return;
    if (previous) selectTarget(previous);
    else if (["error", "limited", "exhausted", "cancelled"].includes(discovery.status))
      setPending(null);
  }, [enabled, discoveringPrevious, discovery.status, previous, selectTarget]);

  const navigate = useStableEvent((direction: -1 | 1) => {
    if (!enabled || !message) return;
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
    if (!enabled) return;
    outline.cancelJump();
    readingContent.cancel();
    retryTarget.current = null;
    discovery.cancel();
    setPending(null);
    setError(false);
    setCancelled(true);
  });
  const reviewReading = useStableEvent(() => {
    if (!enabled) return;
    outline.cancelJump();
    readingContent.cancel();
    discovery.restart();
    retryTarget.current = null;
    setPending(null);
    setError(false);
    setCancelled(false);
  });
  const followLatest = useStableEvent(() => {
    if (!enabled) return;
    cancel();
    setSelected(null);
  });
  const retry = useStableEvent(() => {
    if (!enabled) return;
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
      selectTarget(target, previousAttempt.scroll, {
        preserveSelection: previousAttempt.preserveSelection,
      });
    } else if (message) navigate(retryDirection.current);
    else if (indexed) {
      const newest = targets.at(-1);
      if (newest) readingContent.retry();
      else outline.retryIndex();
    }
  });

  const previousAction = useStableEvent(() => navigate(-1));
  const nextAction = useStableEvent(() => navigate(1));
  const activate = useStableEvent((id: string, direction: -1 | 1) => {
    if (!enabled) return;
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
  const cancelStickyJump = outline.cancelStickyJump;
  const cancelReading = readingContent.cancel;
  const cancelDiscovery = discovery.cancel;
  const restartDiscovery = discovery.restart;

  // Opt-out preserves the mounted timeline and draft. Invalidate only this feature's
  // page acceptance, content completion and navigation before passive effects can run.
  useLayoutEffect(() => {
    if (enabled) {
      restartDiscovery();
      setCancelled(false);
      return;
    }
    cancelStickyJump();
    cancelReading();
    cancelDiscovery();
    retryTarget.current = null;
    setPending(null);
    setSelected(null);
    setError(false);
    setCancelled(true);
  }, [enabled, cancelStickyJump, cancelReading, cancelDiscovery, restartDiscovery]);
  // Epoch replacement resets only prompt ownership. The surrounding viewport keeps
  // its manual/following state, DOM ref and reading anchor across authoritative hydration.
  useLayoutEffect(() => {
    if (ownerEpoch.current === epoch) return;
    ownerEpoch.current = epoch;
    cancelStickyJump();
    cancelDiscovery();
    if (enabled) restartDiscovery();
    retryTarget.current = null;
    retryDirection.current = -1;
    setPending(null);
    setSelected(null);
    setError(false);
    setCancelled(!enabled);
    // The reading-content owner independently cancels old epoch completions without
    // suppressing the new epoch's same-sequence request.
  }, [epoch, enabled, cancelStickyJump, cancelDiscovery, restartDiscovery]);
  const { geometry, sourceMounted } = usePromptGeometry(message?.id, reading, epoch);
  const stickyProgress = resolveStickyPromptProgress(message, reading);
  const busy = isPromptNavigationBusy({
    pending: pending !== null || readingContent.loading,
    jumping: outline.isJumping,
    discovering: discovery.status === "loading",
    indexed,
    epoch,
    cancelled,
    indexReady: outline.indexReady,
    indexError: outline.indexError,
  });

  // The current prompt can be outside the rendered window. Its indexed target
  // uses the same window acceptance and scrolling owner as arrow navigation.
  const reveal = useStableEvent(() => {
    if (!enabled || busy) return;
    const target = targets[position];
    if (target) {
      // Retain the displayed cache copy while the owner loads its original row.
      setSelected(message ?? null);
      selectTarget(target, true, { preserveSelection: true });
    }
  });
  return {
    message,
    stickyProgress,
    geometry,
    sourceMounted,
    occlusionTop: resolvePromptOcclusionTop(targets, position, reading),
    targets,
    previousKnownBoundary: indexed ? outline.indexReady : !hasOlder,
    activate,
    stickyVisible:
      enabled &&
      isStickyPromptVisible(
        message,
        resolveStickyReadingTarget(readingTarget, targets, position),
        reading.rowId,
        stickyProgress,
      ),
    discoveryStatus: discovery.status,
    cancelled,
    busy,
    reveal,
    error: [
      error,
      outline.indexError,
      outline.jumpError,
      discovery.status === "error",
      readingContent.error,
      isContextSourceMissing(contextRequested, contextSource),
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

/** Retain measured bubble geometry through virtualization, but discard it after a pane resize. */
function usePromptGeometry(
  messageId: string | undefined,
  reading: PromptReadingPosition,
  epoch: string | null,
) {
  const currentGeometry = resolvePromptGeometry(
    reading.userHandoffs?.find((frame) => frame.id === messageId),
    reading.viewportWidth,
  );
  const lastGeometry = useRef<{
    epoch: string | null;
    geometry: ReturnType<typeof resolvePromptGeometry>;
  } | null>(null);
  useLayoutEffect(() => {
    if (currentGeometry) lastGeometry.current = { epoch, geometry: currentGeometry };
  }, [currentGeometry, epoch]);
  const cachedGeometry =
    lastGeometry.current?.epoch === epoch ? lastGeometry.current.geometry : undefined;
  const geometry =
    currentGeometry ??
    (cachedGeometry?.id === messageId && cachedGeometry?.viewportWidth === reading.viewportWidth
      ? cachedGeometry
      : undefined);
  return { geometry, sourceMounted: currentGeometry !== undefined };
}

/** Hide previous-epoch bookkeeping before the layout effect clears its stored values. */
function resolveEpochPromptState(
  scopeChanged: boolean,
  state: {
    selected: UserPrompt | null;
    pending: PromptTarget | "previous" | null;
    error: boolean;
    cancelled: boolean;
  },
) {
  if (scopeChanged) return { selected: null, pending: null, error: false, cancelled: false };
  return state;
}
