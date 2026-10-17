import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { FetchAgentTimelineResponseMessage } from "@getpaseo/protocol/messages";
import type { StreamItem } from "@/types/stream";
import { hydratePromptEntry } from "./fetch-prompt-content";
import { TIMELINE_FETCH_PAGE_SIZE } from "@/timeline/timeline-fetch-policy";
import { PROMPT_DISCOVERY_PAGE_BUDGET } from "./use-prompt-discovery";
import type { UserPrompt } from "./sticky-prompt-model";

export type ContextPage = Pick<
  FetchAgentTimelineResponseMessage["payload"],
  "epoch" | "entries" | "hasOlder" | "error" | "reset" | "staleCursor" | "gap"
>;
export type ContextPageReader = (request: {
  epoch: string;
  cursor: number;
  limit: number;
  projection: "projected" | "canonical";
}) => Promise<ContextPage>;
export type ContextEntry = ContextPage["entries"][number];

/** A source occurrence is its canonical position and kind, never messageId alone. */
export function contextSourceKey(source: StreamItem): string {
  return `${source.timelineCursor?.epoch}:${source.timelineCursor?.seq}:${source.kind}:${source.id}`;
}

/** Read backward without applying a window. The source probe shares the eight-read budget.
 * Expanded projected entries may start before a page's owned cursor; actual source ranges
 * determine the next cursor. Ambiguous identity, nonprogress and budget exhaustion fail visibly.
 */
export async function fetchReadingPromptContext(
  reader: ContextPageReader,
  source: StreamItem,
  signal: AbortSignal,
  backwardProjection: "projected" | "canonical" = "canonical",
): Promise<UserPrompt | undefined> {
  const position = source.timelineCursor;
  if (!position) throw new Error("Reading source has no canonical position");
  const read = async (cursor: number, limit: number, projection: "projected" | "canonical") => {
    if (signal.aborted) throw new Error("Reading context was cancelled");
    const page = await reader({ epoch: position.epoch, cursor, limit, projection });
    if (signal.aborted) throw new Error("Reading context was cancelled");
    if (page.epoch !== position.epoch || page.error || page.reset || page.staleCursor || page.gap)
      throw new Error("Reading context changed or is unavailable");
    for (const entry of page.entries) validateContextRange(entry);
    return page;
  };
  const probe = await read(position.seq + 1, 1, "projected");
  const matches = probe.entries.filter((entry) => matchesContextSource(entry, source));
  if (probe.entries.length !== 1 || matches.length !== 1)
    throw new Error("Reading source occurrence is ambiguous");
  let cursor = matches[0]!.seqStart;
  for (let used = 1; used < PROMPT_DISCOVERY_PAGE_BUDGET; used += 1) {
    const page = await read(cursor, TIMELINE_FETCH_PAGE_SIZE, backwardProjection);
    const entries = page.entries;
    if (entries.some((entry) => entry.seqEnd >= cursor))
      throw new Error("Reading context did not move backward");
    const prompt = entries
      .filter((entry) => entry.item.type === "user_message")
      .sort((a, b) => b.seqEnd - a.seqEnd)[0];
    if (prompt) return hydratePromptEntry(prompt, position.epoch);
    if (!page.hasOlder) return undefined;
    const next = entries.length ? Math.min(...entries.map((entry) => entry.seqStart)) : cursor;
    if (next >= cursor) throw new Error("Reading context made no progress");
    cursor = next;
  }
  throw new Error("Reading context reached its request budget");
}

/** Validate real ranges instead of treating a legacy seqEnd as the source start. */
export function validateContextRange(entry: ContextEntry): void {
  if (
    !Number.isInteger(entry.seqStart) ||
    !Number.isInteger(entry.seqEnd) ||
    entry.seqStart < 0 ||
    entry.seqEnd < entry.seqStart ||
    !entry.sourceSeqRanges.length ||
    entry.sourceSeqRanges.some(
      (range) =>
        !Number.isInteger(range.startSeq) ||
        !Number.isInteger(range.endSeq) ||
        range.startSeq < entry.seqStart ||
        range.endSeq > entry.seqEnd ||
        range.endSeq < range.startSeq,
    ) ||
    Math.min(...entry.sourceSeqRanges.map((range) => range.startSeq)) !== entry.seqStart ||
    Math.max(...entry.sourceSeqRanges.map((range) => range.endSeq)) !== entry.seqEnd
  )
    throw new Error("Reading context has invalid canonical ranges");
}

/** Match the exact visible canonical occurrence, including turn and provider identity. */
export function matchesContextSource(entry: ContextEntry, source: StreamItem): boolean {
  const seq = source.timelineCursor?.seq;
  if (seq === undefined || entry.seqEnd !== seq) return false;
  let type: string = source.kind;
  if (source.kind === "thought") type = "reasoning";
  if (source.kind === "notification") type = source.sourceType;
  if (entry.item.type !== type) return false;
  if ("turnId" in source && source.turnId !== undefined && source.turnId !== entry.turnId)
    return false;
  if (source.kind === "assistant_message" && source.messageId !== undefined)
    return entry.item.type === "assistant_message" && entry.item.messageId === source.messageId;
  if (source.kind === "tool_call")
    return (
      source.payload.source === "agent" &&
      entry.item.type === "tool_call" &&
      entry.item.callId === source.payload.data.callId
    );
  return true;
}

/** Use the actual normal-agent journal without a runtime/store window application. */
export function normalContextPageReader(client: DaemonClient, agentId: string): ContextPageReader {
  return async (request) => {
    const page = await client.fetchAgentTimeline(agentId, {
      direction: "before",
      cursor: { epoch: request.epoch, seq: request.cursor },
      limit: request.limit,
      projection: request.projection,
    });
    if (
      page.agentId !== agentId ||
      page.direction !== "before" ||
      page.projection !== request.projection
    )
      throw new Error("Reading context has a different journal identity");
    return page;
  };
}

/** Read a child journal through its exact owner. No response is applied to provider state. */
export function childContextPageReader(
  client: DaemonClient,
  parentAgentId: string,
  subagentId: string,
): ContextPageReader {
  return async (request) => {
    const page = await client.fetchProviderSubagentTimeline(parentAgentId, subagentId, {
      direction: "before",
      cursor: { epoch: request.epoch, seq: request.cursor },
      limit: request.limit,
    });
    if (
      page.parentAgentId !== parentAgentId ||
      page.subagentId !== subagentId ||
      page.direction !== "before" ||
      !page.provider
    )
      throw new Error("Reading context has a different child identity");
    return {
      ...page,
      entries: page.rows.map((row) => {
        if (row.seqStart === undefined || row.seqEnd === undefined || !row.sourceSeqRanges)
          throw new Error("Child context has no canonical source ranges");
        return {
          item: row.item,
          timestamp: row.timestamp,
          provider: page.provider!,
          seqStart: row.seqStart,
          seqEnd: row.seqEnd,
          sourceSeqRanges: row.sourceSeqRanges,
          collapsed: [],
        };
      }),
    };
  };
}
