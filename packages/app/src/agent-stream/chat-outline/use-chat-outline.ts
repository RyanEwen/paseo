import type { PromptJumpPlacement } from "../prompt-jump-placement";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { AgentTimelinePromptIndexPayload } from "@getpaseo/client/internal/daemon-client";
import { useStableEvent } from "@/hooks/use-stable-event";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { planTimelinePromptJump } from "@/timeline/timeline-sync-plan";
import type { StreamItem } from "@/types/stream";
import type { StreamViewportHandle } from "../strategy";
import {
  createActivePromptPublisher,
  resolveActivePromptSeq,
  shouldAcceptPromptIndexEpoch,
  type ActivePromptSource,
  type ChatOutlinePrompt,
} from "./model";

const NO_PROMPTS: ChatOutlinePrompt[] = [];
const NO_STREAM_ITEMS: StreamItem[] = [];

interface PendingPromptJump {
  owner: string;
  requestId: number;
  seq: number;
  fetchSettled: boolean;
  hasScrolled: boolean;
  scroll: boolean;
  placement?: PromptJumpPlacement;
}

export interface UseChatOutlineInput {
  agentId: string;
  serverId: string;
  timelineEpoch: string | null;
  tail: StreamItem[];
  head: StreamItem[] | undefined;
  enabled: boolean;
  viewportRef: RefObject<StreamViewportHandle | null>;
  onJumpError: () => void;
  visibleMessageIds?: ReadonlySet<string>;
  revealLoadedMessage?: (messageId: string) => boolean;
}

export interface ChatOutline {
  prompts: ChatOutlinePrompt[];
  activePrompt: ActivePromptSource;
  jumpToPrompt: (
    seq: number,
    options?: { scroll?: boolean; source?: "sticky" | "outline"; placement?: PromptJumpPlacement },
  ) => void;
  jumpToMessage: (
    id: string,
    options?: { source?: "sticky" | "outline"; placement?: PromptJumpPlacement },
  ) => void;
  reportReadingPosition: (seq: number | null) => void;
  isJumping: boolean;
  jumpError: boolean;
  indexReady: boolean;
  indexError: boolean;
  retryIndex: () => void;
  cancelJump: () => void;
  cancelStickyJump: () => void;
  reportJumpError: () => void;
}

export function useChatOutline({
  agentId,
  serverId,
  timelineEpoch,
  tail,
  head,
  enabled,
  viewportRef,
  onJumpError,
  visibleMessageIds,
  revealLoadedMessage,
}: UseChatOutlineInput): ChatOutline {
  const [indexRevision, setIndexRevision] = useState(0);
  const ownerKey = `${serverId}:${agentId}:${timelineEpoch}`;
  const [indexState, setIndex] = useState<{
    owner: string;
    payload: AgentTimelinePromptIndexPayload;
  } | null>(null);
  const index = indexState?.owner === ownerKey ? indexState.payload : null;
  const [jumpError, setJumpError] = useState(false);
  const [indexError, setIndexError] = useState(false);
  const [pendingJump, setPendingJump] = useState<PendingPromptJump | null>(null);
  const [activePrompt] = useState(createActivePromptPublisher);
  const readingSeqRef = useRef<number | null>(null);
  const jumpSourceRef = useRef<"sticky" | "outline" | null>(null);
  const jumpAcceptanceRef = useRef<AbortController | null>(null);
  const jumpFrameRef = useRef<number | null>(null);
  const nextJumpRequestIdRef = useRef(0);
  const nextIndexRequestIdRef = useRef(0);
  const loadedItems = useMemo(() => [...tail, ...(head ?? NO_STREAM_ITEMS)], [head, tail]);
  const prompts = enabled ? (index?.prompts ?? NO_PROMPTS) : NO_PROMPTS;

  // The viewed timeline already owns live delivery and reconnect catch-up. Its complete
  // loaded items (including rows outside the mounted window) invalidate the prompt index.
  const latestPromptSeq = loadedItems.reduce(
    (latest, item) =>
      item.kind === "user_message" && item.timelineCursor?.epoch === timelineEpoch
        ? Math.max(latest, item.timelineCursor.seq)
        : latest,
    -1,
  );

  useEffect(() => setIndex(null), [agentId, enabled, serverId, timelineEpoch]);

  // Only a timeline the daemon has served can be indexed. A draft's optimistic stream has no
  // epoch, and its id names no agent the daemon knows.
  useEffect(() => {
    if (!enabled || timelineEpoch === null) {
      setIndex(null);
      return;
    }
    const client = getHostRuntimeStore().getClient(serverId);
    if (!client) return;
    let active = true;
    const refresh = () => {
      const requestId = ++nextIndexRequestIdRef.current;
      void client
        .listAgentTimelinePrompts(agentId)
        .then((payload) => {
          if (
            active &&
            requestId === nextIndexRequestIdRef.current &&
            shouldAcceptPromptIndexEpoch(timelineEpoch, payload.epoch)
          ) {
            if (payload.error) {
              setIndexError(true);
              return;
            }
            setIndexError(false);
            setIndex({ owner: ownerKey, payload });
          }
          return undefined;
        })
        .catch(() => {
          if (active) setIndexError(true);
        });
    };
    refresh();
    return () => {
      active = false;
    };
  }, [agentId, enabled, serverId, timelineEpoch, latestPromptSeq, indexRevision, ownerKey]);

  // The transcript resolves display rows (including Markdown blocks and plugin cards) to
  // timeline positions. The outline uses the complete index, including unloaded prompts.
  const publishActivePrompt = useStableEvent(() => {
    activePrompt.publish(resolveActivePromptSeq(prompts, readingSeqRef.current));
  });

  const reportReadingPosition = useStableEvent((seq: number | null) => {
    readingSeqRef.current = seq;
    publishActivePrompt();
  });

  /** Invalidate only this navigation intent, including its page acceptance and delayed scroll. */
  const cancelJump = useStableEvent(() => {
    jumpSourceRef.current = null;
    nextJumpRequestIdRef.current += 1;
    jumpAcceptanceRef.current?.abort();
    jumpAcceptanceRef.current = null;
    if (jumpFrameRef.current !== null) cancelAnimationFrame(jumpFrameRef.current);
    jumpFrameRef.current = null;
    viewportRef.current?.cancelMessageScroll?.();
    setPendingJump(null);
    setJumpError(false);
  });

  /** A feature opt-out cancels only navigation initiated by that feature. */
  const cancelStickyJump = useStableEvent(() => {
    if (jumpSourceRef.current === "sticky") cancelJump();
  });

  useEffect(() => {
    cancelJump();
    setIndexError(false);
    readingSeqRef.current = null;
    activePrompt.publish(null);
    return cancelJump;
  }, [activePrompt, cancelJump, agentId, serverId, timelineEpoch]);

  // The transcript reports its reading position long before the index arrives, and a reader
  // who never scrolls would otherwise sit on an unmarked rail.
  useEffect(() => {
    publishActivePrompt();
  }, [prompts, publishActivePrompt]);

  useEffect(() => {
    if (
      pendingJump === null ||
      pendingJump.owner !== ownerKey ||
      pendingJump.requestId !== nextJumpRequestIdRef.current
    )
      return;
    const target = loadedItems.find((item) => item.timelineCursor?.seq === pendingJump.seq);
    if (target) {
      if (pendingJump.hasScrolled) {
        if (pendingJump.fetchSettled) setPendingJump(null);
        return;
      }
      if (pendingJump.scroll && visibleMessageIds?.has(target.id) === false) {
        revealLoadedMessage?.(target.id);
        return;
      }
      if (pendingJump.scroll)
        scrollToPlacedMessage(viewportRef.current, target.id, pendingJump.placement);
      setPendingJump((current) => {
        if (current?.requestId !== pendingJump.requestId) return current;
        return { ...current, hasScrolled: true };
      });
      return;
    }
    if (pendingJump.fetchSettled) {
      setJumpError(true);
      setPendingJump(null);
    }
  }, [loadedItems, ownerKey, pendingJump, revealLoadedMessage, viewportRef, visibleMessageIds]);

  const jumpToPrompt = useCallback(
    (
      seq: number,
      options?: {
        scroll?: boolean;
        source?: "sticky" | "outline";
        placement?: PromptJumpPlacement;
      },
    ) => {
      const scroll = options?.scroll !== false;
      cancelJump();
      jumpSourceRef.current = options?.source ?? "outline";
      const loaded = loadedItems.find((item) => item.timelineCursor?.seq === seq);
      if (loaded) {
        if (scroll && revealLoadedMessage?.(loaded.id)) {
          const requestId = nextJumpRequestIdRef.current;
          setPendingJump({
            owner: ownerKey,
            requestId,
            seq,
            fetchSettled: true,
            hasScrolled: false,
            scroll,
            placement: options?.placement,
          });
          return;
        }
        if (scroll) scrollToPlacedMessage(viewportRef.current, loaded.id, options?.placement);
        return;
      }
      if (!index) return;
      const requestId = nextJumpRequestIdRef.current;
      const acceptance = new AbortController();
      jumpAcceptanceRef.current = acceptance;
      setPendingJump({
        owner: ownerKey,
        requestId,
        seq,
        fetchSettled: false,
        hasScrolled: false,
        scroll,
        placement: options?.placement,
      });
      void getHostRuntimeStore()
        .fetchAgentTimeline(
          serverId,
          agentId,
          planTimelinePromptJump({ epoch: index.epoch, seq }),
          { signal: acceptance.signal },
        )
        .catch((error: unknown) => {
          if (requestId === nextJumpRequestIdRef.current) {
            console.warn("Failed to load a Chat outline window", error);
            setJumpError(true);
            onJumpError();
          }
        })
        .finally(() => {
          setPendingJump((current) => {
            if (current?.requestId !== requestId) return current;
            return { ...current, fetchSettled: true };
          });
        });
    },
    [
      agentId,
      cancelJump,
      index,
      loadedItems,
      onJumpError,
      ownerKey,
      revealLoadedMessage,
      serverId,
      viewportRef,
    ],
  );

  /** Local submissions and child transcript rows do not require a root prompt index. */
  const jumpToMessage = useStableEvent(
    (id: string, options?: { source?: "sticky" | "outline"; placement?: PromptJumpPlacement }) => {
      const item = loadedItems.find((entry) => entry.id === id);
      if (item?.timelineCursor) {
        jumpToPrompt(item.timelineCursor.seq, options);
        return;
      }
      cancelJump();
      jumpSourceRef.current = options?.source ?? "outline";
      const requestId = nextJumpRequestIdRef.current;
      revealLoadedMessage?.(id);
      jumpFrameRef.current = requestAnimationFrame(() => {
        jumpFrameRef.current = null;
        if (requestId === nextJumpRequestIdRef.current)
          scrollToPlacedMessage(viewportRef.current, id, options?.placement);
      });
    },
  );

  const reportJumpError = useStableEvent(() => {
    setJumpError(true);
    onJumpError();
  });

  return {
    reportJumpError,
    cancelStickyJump,
    jumpToMessage,
    cancelJump,
    prompts,
    activePrompt,
    jumpToPrompt,
    reportReadingPosition,
    isJumping: pendingJump !== null,
    jumpError,
    indexReady: index !== null,
    indexError,
    retryIndex: () => setIndexRevision((value) => value + 1),
  };
}

/** Preserve existing occurrence/default navigation while forwarding explicit arrow placement. */
function scrollToPlacedMessage(
  viewport: StreamViewportHandle | null,
  id: string,
  placement?: PromptJumpPlacement,
) {
  if (placement === "pinned") viewport?.scrollToMessage?.(id, undefined, placement);
  else viewport?.scrollToMessage?.(id);
}
