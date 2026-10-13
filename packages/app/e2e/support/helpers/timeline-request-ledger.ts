import type { FetchAgentTimelineResponseMessage } from "@getpaseo/protocol/messages";
import { TIMELINE_FETCH_PAGE_SIZE } from "../../../src/timeline/timeline-fetch-policy";

type TimelineRequestSchemas = Pick<
  typeof import("@getpaseo/protocol/messages"),
  | "AgentTimelineEntryPayloadSchema"
  | "AgentTimelineListPromptsResponseMessageSchema"
  | "FetchAgentTimelineRequestMessageSchema"
  | "FetchAgentTimelineResponseMessageSchema"
>;

export type TimelineReadPurpose = "window" | "content";
interface ContentTarget {
  epoch: string;
  seq: number;
}

/** Account for every before request, with independent capability-validated cache reads.
 * Violations are retained for the owning test assertion instead of escaping a socket callback.
 * Cache reads never become held history pages or enter the projected-row ownership ledger.
 */
export function createTimelineRequestLedger(agentId: string, schemas: TimelineRequestSchemas) {
  // The browser harness injects its native ESM protocol instance. A static runtime
  // import here would make Playwright transform a second instance before client loading.
  const {
    AgentTimelineEntryPayloadSchema,
    AgentTimelineListPromptsResponseMessageSchema,
    FetchAgentTimelineRequestMessageSchema,
    FetchAgentTimelineResponseMessageSchema,
  } = schemas;
  let indexed = false;
  let indexEpoch: string | null = null;
  let promptSeqs = new Set<number>();
  const loaded = new Set<string>();
  const content = new Map<string, ContentTarget>();
  const requestedContent = new Set<string>();
  const completedContent = new Set<string>();
  const purposes = new Map<string, TimelineReadPurpose>();
  const errors: string[] = [];
  let allBefore = 0;
  let windowBefore = 0;

  const reject = (reason: string) => {
    errors.push(reason);
    return undefined;
  };

  return {
    /** Observe actual advertised capability and the canonical index before classifying reads. */
    observe(message: Record<string, unknown>, payload: Record<string, unknown> | null) {
      if (message.type === "status" && payload?.status === "server_info") {
        const features = payload.features as Record<string, unknown> | undefined;
        indexed = features?.agentTimelinePromptIndex === true;
      }
      if (message.type !== "agent.timeline.list_prompts.response" || payload?.agentId !== agentId)
        return;
      const result = AgentTimelineListPromptsResponseMessageSchema.shape.payload.safeParse(payload);
      if (!result.success) {
        indexEpoch = null;
        promptSeqs.clear();
        reject("Malformed canonical prompt index");
        return;
      }
      if (!indexed || result.data.error) return;
      indexEpoch = result.data.epoch;
      promptSeqs = new Set(result.data.prompts.map((prompt) => prompt.seq));
    },

    /** Unknown shapes, repeated IDs and redundant cache reads fail the all-request contract. */
    classify(request: Record<string, unknown>): TimelineReadPurpose | undefined {
      allBefore += 1;
      const parsed = FetchAgentTimelineRequestMessageSchema.safeParse(request);
      if (
        !parsed.success ||
        parsed.data.agentId !== agentId ||
        parsed.data.direction !== "before"
      ) {
        return reject("Invalid before request identity");
      }
      const id = parsed.data.requestId;
      const cursor = parsed.data.cursor;
      if (typeof id !== "string" || purposes.has(id))
        return reject("Missing or repeated timeline request ID");
      if (
        request.projection !== "projected" ||
        typeof cursor?.epoch !== "string" ||
        !Number.isInteger(cursor.seq)
      ) {
        return reject("Unclassified before request projection or cursor");
      }
      if (request.limit === TIMELINE_FETCH_PAGE_SIZE) {
        purposes.set(id, "window");
        windowBefore += 1;
        return "window";
      }
      if (
        request.limit !== 1 ||
        request.mergeWindow === true ||
        !indexed ||
        cursor.epoch !== indexEpoch
      ) {
        return reject("Unclassified before request purpose or capability");
      }
      const seq = cursor.seq! - 1;
      const key = `${cursor.epoch}:${seq}`;
      if (!promptSeqs.has(seq) || loaded.has(key) || requestedContent.has(key)) {
        return reject("Content read must target one uncached canonical indexed prompt per epoch");
      }
      requestedContent.add(key);
      content.set(id, { epoch: cursor.epoch, seq });
      purposes.set(id, "content");
      return "content";
    },

    /** Every before response must belong to one previously classified request. */
    ownsRequest(requestId: unknown) {
      return typeof requestId === "string" && purposes.has(requestId);
    },

    beforeResponsePurpose(payload: Record<string, unknown>) {
      if (payload.agentId !== agentId || payload.direction !== "before")
        return reject("Invalid before response identity");
      const requestId = payload.requestId;
      const purpose = typeof requestId === "string" ? purposes.get(requestId) : undefined;
      if (!purpose) return reject("Unclassified before response request ID");
      return purpose;
    },

    /** Validate one canonical USER response, including its authoritative sequence and projection. */
    completeContent(payload: Record<string, unknown>) {
      const id = String(payload.requestId);
      const target = content.get(id);
      const result = FetchAgentTimelineResponseMessageSchema.shape.payload.safeParse(payload);
      if (!result.success) {
        reject("Malformed canonical prompt-content response");
        if (target) completedContent.add(id);
        return;
      }
      const page = result.data;
      if (!target || completedContent.has(id) || !matchesContentTarget(page, target, agentId)) {
        reject("Invalid or repeated canonical prompt-content response");
      }
      completedContent.add(id);
    },

    /** Track prompts already returned by authoritative pages, not by their sticky copies. */
    observeWindow(payload: Record<string, unknown>) {
      if (typeof payload.epoch !== "string" || !Array.isArray(payload.entries)) return;
      for (const entry of payload.entries) {
        const result = AgentTimelineEntryPayloadSchema.safeParse(entry);
        if (result.success && result.data.item.type === "user_message") {
          loaded.add(`${payload.epoch}:${result.data.seqEnd}`);
        }
      }
    },

    summary() {
      return {
        allBefore,
        windowBefore,
        contentBefore: content.size,
        pendingContent: content.size - completedContent.size,
        errors: [...errors],
      };
    },
  };
}

/** Match a schema-valid response to the exact cached USER identity, never an overlapping range. */
function matchesContentTarget(
  page: FetchAgentTimelineResponseMessage["payload"],
  target: ContentTarget,
  agentId: string,
) {
  if (
    page.agentId !== agentId ||
    page.direction !== "before" ||
    page.epoch !== target.epoch ||
    page.projection !== "projected"
  )
    return false;
  if (page.error || page.reset || page.staleCursor || page.gap || page.mergeWindow === true)
    return false;
  if (page.entries.length !== 1) return false;
  const entry = page.entries[0]!;
  return (
    entry.item.type === "user_message" &&
    entry.seqStart === target.seq &&
    entry.seqEnd === target.seq &&
    matchesContentCursor(page.startCursor, target) &&
    matchesContentCursor(page.endCursor, target)
  );
}

/** Both returned bounds must name the expected prompt in its original epoch. */
function matchesContentCursor(
  cursor: FetchAgentTimelineResponseMessage["payload"]["startCursor"],
  target: ContentTarget,
) {
  return cursor?.epoch === target.epoch && cursor.seq === target.seq;
}
