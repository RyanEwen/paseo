import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStableEvent } from "@/hooks/use-stable-event";
import type { StreamItem } from "@/types/stream";
import { contextSourceKey } from "./fetch-reading-prompt-context";
import type { UserPrompt } from "./sticky-prompt-model";

/** Read only the prompt belonging to a visible response. This cache never applies a
 * transcript window or owns scrolling. Epoch-scoped state and cancellation isolate its bounded contents without remounting the viewport.
 */
export function useReadingPrompt(input: {
  seq: number | undefined;
  epoch: string | null;
  knownPrompts: readonly UserPrompt[];
  fetchPrompt?: (seq: number) => Promise<UserPrompt>;
  source?: StreamItem;
  fetchContext?: (source: StreamItem, signal: AbortSignal) => Promise<UserPrompt | undefined>;
}) {
  const { fetchPrompt, epoch } = input;
  const desiredKey = readingCacheKey(input.source, input.seq);
  const readContent = useStableEvent(async (signal: AbortSignal) => {
    const source = input.source;
    const item = source
      ? await input.fetchContext!(source, signal)
      : await input.fetchPrompt!(input.seq!);
    if (source && item && item.timelineCursor?.epoch !== source.timelineCursor?.epoch)
      throw new Error("Reading prompt belongs to a different epoch");
    return item;
  });
  const contentScope = useMemo(
    () => ({ epoch, cache: new Map<string, UserPrompt | undefined>() }),
    [epoch],
  );
  const cache = contentScope.cache;
  const ownerEpoch = useRef(epoch);
  const operation = useRef<{ cancelled: boolean; controller: AbortController } | null>(null);
  const suppressedSeq = useRef<string | undefined>(undefined);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    epoch: string | null;
    key: string | undefined;
    loading: boolean;
    error: boolean;
    item?: UserPrompt;
  }>({ epoch, key: undefined, loading: false, error: false });
  const cancel = useStableEvent(() => {
    if (operation.current) {
      operation.current.cancelled = true;
      operation.current.controller.abort();
    }
    suppressedSeq.current = desiredKey;
    setState((current) => ({ ...current, loading: false, error: false }));
  });
  const retry = useStableEvent(() => {
    suppressedSeq.current = undefined;
    setRevision((current) => current + 1);
  });
  // Invalidate old completions and cancellation suppression before passive reads run.
  useLayoutEffect(() => {
    if (ownerEpoch.current === epoch) return;
    ownerEpoch.current = epoch;
    if (operation.current) {
      operation.current.cancelled = true;
      operation.current.controller.abort();
    }
    operation.current = null;
    suppressedSeq.current = undefined;
    setRevision(0);
    setState({ epoch, key: undefined, loading: false, error: false });
  }, [epoch]);
  useEffect(() => {
    for (const item of input.knownPrompts) {
      const seq = item.timelineCursor?.seq;
      if (seq === undefined || item.timelineCursor?.epoch !== epoch) continue;
      cache.delete(`prompt:${seq}`);
      cache.set(`prompt:${seq}`, item);
      if (cache.size > 16) cache.delete(cache.keys().next().value!);
    }
  }, [input.knownPrompts, cache, epoch]);
  const canRead = input.source ? !!input.fetchContext : !!fetchPrompt;
  useEffect(() => {
    const key = desiredKey;
    if (key === undefined || suppressedSeq.current === key || !canRead) return;
    if (cache.has(key)) {
      setState({ epoch, key, loading: false, error: false, item: cache.get(key) });
      return;
    }
    const current = { cancelled: false, controller: new AbortController() };
    operation.current = current;
    setState({ epoch, key, loading: true, error: false });
    void (async () => {
      try {
        const item = await readContent(current.controller.signal);
        if (current.cancelled || ownerEpoch.current !== epoch) return;

        cache.set(key, item);
        if (cache.size > 16) cache.delete(cache.keys().next().value!);
        setState({ epoch, key, loading: false, error: false, item });
      } catch {
        if (!current.cancelled && ownerEpoch.current === epoch)
          setState({ epoch, key, loading: false, error: true });
      }
    })();
    return () => {
      current.cancelled = true;
      current.controller.abort();
    };
  }, [desiredKey, canRead, readContent, revision, cache, epoch]);

  return {
    item: state.epoch === epoch && state.key === desiredKey ? state.item : undefined,
    loading:
      desiredKey !== undefined &&
      state.epoch === epoch &&
      state.key === desiredKey &&
      state.loading,
    error:
      desiredKey !== undefined && state.epoch === epoch && state.key === desiredKey && state.error,
    cancel,
    retry,
  };
}

/** Keep source identity stable while response text streams; both read types share one cache. */
function readingCacheKey(source: StreamItem | undefined, seq: number | undefined) {
  if (source) return `context:${contextSourceKey(source)}`;
  if (seq !== undefined) return `prompt:${seq}`;
  return undefined;
}
