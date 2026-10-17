import { useEffect, useRef, useState } from "react";
import { useStableEvent } from "@/hooks/use-stable-event";
import type { TimelinePageAcceptance } from "@/timeline/fetch-viewed-timeline-page";

export const PROMPT_DISCOVERY_PAGE_BUDGET = 8;
export type PromptDiscoveryStatus =
  | "idle"
  | "loading"
  | "complete"
  | "exhausted"
  | "error"
  | "limited"
  | "cancelled";

function createOperation(stopped = false) {
  return {
    stopped,
    keys: new Set<string>(),
    pending: false,
    controller: null as AbortController | null,
  };
}

/** Discover a prompt through the existing page owner, with bounded work per explicit retry.
 * Each accepted page must advance the authoritative cursor. Cancellation fences the current
 * page's application and all later completions without cancelling shared transport reads.
 */
export function usePromptDiscovery(input: {
  enabled: boolean;
  reached: boolean;
  hasOlder: boolean;
  loadingOlder: boolean;
  progressKey: string;
  loadOlder: (acceptance?: TimelinePageAcceptance) => boolean | Promise<boolean>;
}) {
  const { enabled, reached, hasOlder, loadingOlder, progressKey, loadOlder } = input;
  const operation = useRef(createOperation());
  const [status, setStatus] = useState<PromptDiscoveryStatus>("idle");

  const restart = useStableEvent(() => {
    operation.current.controller?.abort();
    operation.current = createOperation();
    setStatus("idle");
  });
  const cancel = useStableEvent(() => {
    operation.current.controller?.abort();
    operation.current = createOperation(true);
    setStatus("cancelled");
  });
  useEffect(() => {
    operation.current = createOperation();
    return () => {
      operation.current.controller?.abort();
      operation.current = createOperation(true);
    };
  }, []);

  useEffect(() => {
    const current = operation.current;
    if (!enabled || current.stopped) return;
    if (reached) {
      if (status !== "complete") setStatus("complete");
      return;
    }
    if (loadingOlder || current.pending) return;
    if (!hasOlder) {
      if (current.keys.size > 0 && status !== "exhausted") setStatus("exhausted");
      return;
    }
    if (current.keys.has(progressKey)) {
      current.stopped = true;
      setStatus("error");
      return;
    }
    if (current.keys.size >= PROMPT_DISCOVERY_PAGE_BUDGET) {
      current.stopped = true;
      setStatus("limited");
      return;
    }

    current.keys.add(progressKey);
    current.pending = true;
    current.controller = new AbortController();
    setStatus("loading");
    void (async () => {
      try {
        const started = await loadOlder({ signal: current.controller!.signal });
        if (operation.current !== current) return;
        if (!started) {
          current.stopped = true;
          setStatus("error");
        } else {
          setStatus("idle");
        }
      } catch {
        if (operation.current !== current) return;
        current.stopped = true;
        setStatus("error");
      } finally {
        current.pending = false;
      }
    })();
  }, [enabled, reached, hasOlder, loadingOlder, progressKey, loadOlder, status]);

  return { status, restart, cancel };
}
