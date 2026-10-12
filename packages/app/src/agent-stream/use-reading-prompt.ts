import { useEffect, useRef, useState } from "react";
import { useStableEvent } from "@/hooks/use-stable-event";
import type { UserPrompt } from "./sticky-prompt-model";

/** Read only the prompt belonging to a visible response. This cache never applies a
 * transcript window or owns scrolling. Session/epoch remounts isolate its bounded contents.
 */
export function useReadingPrompt(input: {
  seq: number | undefined;
  knownPrompts: readonly UserPrompt[];
  fetchPrompt?: (seq: number) => Promise<UserPrompt>;
}) {
  const { seq: desiredSeq, fetchPrompt } = input;
  const cache = useRef(new Map<number, UserPrompt>());
  const operation = useRef<{ seq: number; cancelled: boolean } | null>(null);
  const suppressedSeq = useRef<number | undefined>(undefined);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    seq: number | undefined;
    loading: boolean;
    error: boolean;
    item?: UserPrompt;
  }>({ seq: undefined, loading: false, error: false });
  const cancel = useStableEvent(() => {
    if (operation.current) operation.current.cancelled = true;
    suppressedSeq.current = input.seq;
    setState((current) => ({ ...current, loading: false, error: false }));
  });
  const retry = useStableEvent(() => {
    suppressedSeq.current = undefined;
    setRevision((current) => current + 1);
  });
  useEffect(() => {
    for (const item of input.knownPrompts) {
      const seq = item.timelineCursor?.seq;
      if (seq === undefined) continue;
      cache.current.delete(seq);
      cache.current.set(seq, item);
      if (cache.current.size > 16) cache.current.delete(cache.current.keys().next().value!);
    }
  }, [input.knownPrompts]);
  useEffect(() => {
    const seq = desiredSeq;
    if (seq === undefined || !fetchPrompt || suppressedSeq.current === seq) return;
    const cached = cache.current.get(seq);
    if (cached) {
      setState({ seq, loading: false, error: false, item: cached });
      return;
    }
    const current = { seq, cancelled: false };
    operation.current = current;
    setState({ seq, loading: true, error: false });
    void (async () => {
      try {
        const item = await fetchPrompt(seq);
        if (current.cancelled) return;
        cache.current.set(seq, item);
        if (cache.current.size > 16) cache.current.delete(cache.current.keys().next().value!);
        setState({ seq, loading: false, error: false, item });
      } catch {
        if (!current.cancelled) setState({ seq, loading: false, error: true });
      }
    })();
    return () => {
      current.cancelled = true;
    };
  }, [desiredSeq, fetchPrompt, revision]);
  return {
    item: state.seq === input.seq ? state.item : undefined,
    loading: input.seq !== undefined && state.seq === input.seq && state.loading,
    error: input.seq !== undefined && state.seq === input.seq && state.error,
    cancel,
    retry,
  };
}
