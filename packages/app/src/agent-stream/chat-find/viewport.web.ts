import { revealFindOccurrence } from "./body-reveal.web";
import type { ChatFindOperations } from "./model";
import type { ChatFindProps } from "./types";
import { findMessageMatches, findMessageRows, findRenderedMatches } from "./ranges.web";

interface ViewportInput {
  getBindings(): Pick<ChatFindProps, "viewportRef" | "revealLoadedMessage" | "visibleMessageIds">;
  getRoot(): HTMLElement | null;
  highlightName: string;
}

function rowOf(range: Range): HTMLElement | null {
  return range.startContainer.parentElement?.closest<HTMLElement>("[data-history-row-id]") ?? null;
}

export function createFindViewport({
  getBindings,
  getRoot,
  highlightName,
}: ViewportInput): Pick<ChatFindOperations, "reveal" | "clear"> {
  let generation = 0;
  return {
    clear() {
      generation += 1;
      CSS.highlights.delete(highlightName);
    },
    // A message renders as one row per Markdown block, so an occurrence can sit in
    // any of them and the chosen one decides where the viewport lands.
    reveal(messageId, query, occurrence, signal) {
      const owner = ++generation;
      return new Promise((resolve, reject) => {
        let frame = 0;
        let started = false;
        let expansionRequested = false;
        const deadline = performance.now() + 5000;
        const cleanup = () => {
          cancelAnimationFrame(frame);
          signal.removeEventListener("abort", cancelled);
        };
        const cancelled = () => {
          cleanup();
          reject(new Error("Search cancelled"));
        };
        const poll = () => {
          if (signal.aborted || owner !== generation) {
            cancelled();
            return;
          }
          if (performance.now() >= deadline) {
            cleanup();
            reject(new Error("Could not reveal this match; retry"));
            return;
          }
          const current = getBindings();
          if (!current.visibleMessageIds.has(messageId)) {
            current.revealLoadedMessage(messageId);
            frame = requestAnimationFrame(poll);
            return;
          }
          if (!expansionRequested && current.viewportRef.current) {
            current.viewportRef.current.expandMessageForFind?.(messageId, signal);
            expansionRequested = true;
          }
          const rows = findMessageRows(getRoot(), messageId);
          if (!rows.some((row) => row.getBoundingClientRect().height)) {
            if (!started) {
              current.viewportRef.current?.scrollToMessage?.(messageId);
              started = true;
            }
            frame = requestAnimationFrame(poll);
            return;
          }
          const body = rows[0]?.querySelector<HTMLElement>(
            '[data-testid="user-message-body-scroll"]',
          );
          if (body?.dataset.bodyExpanded === "false") {
            frame = requestAnimationFrame(poll);
            return;
          }
          const ranges = findMessageMatches(getRoot(), messageId, query);
          const index =
            occurrence < 0 ? ranges.length - 1 : Math.min(occurrence, ranges.length - 1);
          const range = ranges[index];
          cleanup();
          if (!range) {
            resolve({ occurrence: 0, count: 0 });
            return;
          }
          // The settle loop re-resolves the range every frame because scrolling
          // invalidates it. Re-counting the whole message would let a row mounting or
          // unmounting mid-scroll shift which occurrence a fixed index names, so the
          // occurrence is pinned to its own row for the rest of this reveal.
          const row = rowOf(range);
          const indexInRow = ranges
            .slice(0, index)
            .filter((earlier) => rowOf(earlier) === row).length;
          current.viewportRef.current?.scrollToMessage?.(messageId, {
            signal,
            targetTop() {
              if (signal.aborted || owner !== generation || performance.now() >= deadline)
                return null;
              const selected = row?.isConnected
                ? findRenderedMatches(row, query)[indexInRow]
                : undefined;
              if (!selected) return null;
              CSS.highlights.set(highlightName, new Highlight(selected));
              const widget = getRoot()?.querySelector<HTMLElement>(
                '[data-chat-find-widget="true"]',
              );
              const clearance = widget ? widget.getBoundingClientRect().height + 8 : 0;
              return row
                ? revealFindOccurrence({ range: selected, row, signal, deadline, clearance })
                : null;
            },
          });
          CSS.highlights.set(highlightName, new Highlight(range));
          resolve({ occurrence: index, count: ranges.length });
        };
        signal.addEventListener("abort", cancelled, { once: true });
        frame = requestAnimationFrame(poll);
      });
    },
  };
}
