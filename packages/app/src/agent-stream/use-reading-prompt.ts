import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStableEvent } from "@/hooks/use-stable-event";
import type { UserPrompt } from "./sticky-prompt-model";

/** Read only the prompt belonging to a visible response. This cache never applies a
 * transcript window or owns scrolling. Epoch-scoped state and cancellation isolate its bounded contents without remounting the viewport.
 */
export function useReadingPrompt(input: {
  seq: number | undefined;
  epoch: string | null;
  knownPrompts: readonly UserPrompt[];
  fetchPrompt?: (seq: number) => Promise<UserPrompt>;
}) {
  const { seq: desiredSeq, fetchPrompt, epoch } = input;
  const contentScope = useMemo(() => ({ epoch, cache: new Map<number, UserPrompt>() }), [epoch]);
  const cache = contentScope.cache;
  const ownerEpoch = useRef(epoch);
  const operation = useRef<{ seq: number; cancelled: boolean } | null>(null);
  const suppressedSeq = useRef<number | undefined>(undefined);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    epoch: string | null;
    seq: number | undefined;
    loading: boolean;
    error: boolean;
    item?: UserPrompt;
  }>({ epoch, seq: undefined, loading: false, error: false });
  const cancel = useStableEvent(() => {
    if (operation.current) operation.current.cancelled = true;
    suppressedSeq.current = input.seq;
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
    if (operation.current) operation.current.cancelled = true;
    operation.current = null;
    suppressedSeq.current = undefined;
    setRevision(0);
    setState({ epoch, seq: undefined, loading: false, error: false });
  }, [epoch]);
  useEffect(() => {
    for (const item of input.knownPrompts) {
      const seq = item.timelineCursor?.seq;
      if (seq === undefined || item.timelineCursor?.epoch !== epoch) continue;
      cache.delete(seq);
      cache.set(seq, item);
      if (cache.size > 16) cache.delete(cache.keys().next().value!);
    }
  }, [input.knownPrompts, cache, epoch]);
  useEffect(() => {
    const seq = desiredSeq;
    if (seq === undefined || !fetchPrompt || suppressedSeq.current === seq) return;
    const cached = cache.get(seq);
    if (cached) {
      setState({ epoch, seq, loading: false, error: false, item: cached });
      return;
    }
    const current = { seq, cancelled: false };
    operation.current = current;
    setState({ epoch, seq, loading: true, error: false });
    void (async () => {
      try {
        const item = await fetchPrompt(seq);
        if (current.cancelled || ownerEpoch.current !== epoch) return;
        cache.set(seq, item);
        if (cache.size > 16) cache.delete(cache.keys().next().value!);
        setState({ epoch, seq, loading: false, error: false, item });
      } catch {
        if (!current.cancelled && ownerEpoch.current === epoch)
          setState({ epoch, seq, loading: false, error: true });
      }
    })();
    return () => {
      current.cancelled = true;
    };
  }, [desiredSeq, fetchPrompt, revision, cache, epoch]);
  return {
    item: state.epoch === epoch && state.seq === input.seq ? state.item : undefined,
    loading:
      input.seq !== undefined && state.epoch === epoch && state.seq === input.seq && state.loading,
    error:
      input.seq !== undefined && state.epoch === epoch && state.seq === input.seq && state.error,
    cancel,
    retry,
  };
}
