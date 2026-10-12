import { useEffect, useMemo, useRef, useState } from "react";
import { useStableEvent } from "@/hooks/use-stable-event";
import type { StreamItem } from "@/types/stream";
import type { ChatOutline } from "./chat-outline/use-chat-outline";
import {
  buildPromptTargets,
  findPromptTarget,
  type PromptTarget,
  type UserPrompt,
} from "./sticky-prompt-model";

interface Input {
  items: StreamItem[];
  epoch: string | null;
  outline: ChatOutline;
  indexed: boolean;
  hasOlder: boolean;
  loadingOlder: boolean;
  progressKey: string | null;
  loadOlder: () => boolean | Promise<boolean>;
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
  const targets = useMemo(
    () => buildPromptTargets(items, outline.prompts, epoch),
    [items, outline.prompts, epoch],
  );
  const [selected, setSelected] = useState<UserPrompt | null>(null);
  const [pending, setPending] = useState<PromptTarget | "previous" | null>(null);
  const [error, setError] = useState(false);
  const [pagePending, setPagePending] = useState(false);
  const mounted = useRef(true);
  const retryDirection = useRef<-1 | 1>(-1);
  const requestedPageRef = useRef<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const latest =
    targets.at(-1)?.item ??
    items.findLast((item): item is UserPrompt => item.kind === "user_message");
  const message = selected ?? latest;
  const position = message ? findPromptTarget(targets, message) : -1;

  const selectTarget = useStableEvent((target: PromptTarget) => {
    setError(false);
    if (target.item) {
      setSelected(target.key === targets.at(-1)?.key ? null : target.item);
      setPending(null);
      jumpToLoaded(target.item.id);
    } else if (target.seq !== undefined) {
      setPending(target);
      outline.jumpToPrompt(target.seq);
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
    if (!message && newest && !pending && !error && !outline.jumpError) selectTarget(newest);
  }, [error, message, outline.jumpError, pending, selectTarget, targets]);

  // Index-free child/older-host transcripts use ordinary backwards pagination. Keep
  // loading until a user prompt is found, rather than mistaking a tool-only page for a bound.
  useEffect(() => {
    if (pending !== "previous" || loadingOlder || pagePending) return;
    const previous = targets[position - 1];
    if (previous) {
      selectTarget(previous);
      return;
    }
    if (!hasOlder) {
      setPending(null);
      return;
    }
    const pageKey = progressKey ?? items[0]?.id ?? "empty";
    if (requestedPageRef.current === pageKey) {
      setError(true);
      setPending(null);
      return;
    }
    requestedPageRef.current = pageKey;
    setPagePending(true);
    void (async () => {
      try {
        const started = await loadOlder();
        if (mounted.current && !started) {
          setError(true);
          setPending(null);
        }
      } catch {
        if (mounted.current) {
          setError(true);
          setPending(null);
        }
      } finally {
        if (mounted.current) setPagePending(false);
      }
    })();
  }, [
    hasOlder,
    items,
    loadOlder,
    loadingOlder,
    pagePending,
    pending,
    position,
    progressKey,
    selectTarget,
    targets,
  ]);

  const navigate = useStableEvent((direction: -1 | 1) => {
    if (!message) return;
    requestedPageRef.current = null;
    retryDirection.current = direction;
    // Freeze the current prompt before a remote jump replaces the loaded window.
    setSelected(message);
    const target = targets[position + direction];
    if (target) selectTarget(target);
    else if (direction === -1 && hasOlder) setPending("previous");
  });

  return {
    message,
    busy: pending !== null || outline.isJumping,
    error: error || outline.indexError,
    previousDisabled:
      !message ||
      (indexed && !outline.indexReady) ||
      (position <= 0 && (indexed ? outline.indexReady : !hasOlder) && !outline.indexError),
    nextDisabled: !message || position < 0 || position >= targets.length - 1,
    retry: () => navigate(retryDirection.current),
    previous: () => navigate(-1),
    next: () => navigate(1),
    followLatest: () => {
      setSelected(null);
      setPending(null);
      setError(false);
    },
  };
}
