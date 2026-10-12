import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { ViewedTimelineOwner } from "./viewed-timeline-sync";

export interface TimelinePageAcceptance {
  signal: AbortSignal;
}

type TimelinePage = Awaited<ReturnType<DaemonClient["fetchAgentTimeline"]>>;
type PageOwner = Pick<ViewedTimelineOwner, "flushStreamAgent" | "applyTimelineResponse">;

/**
 * Apply a fetched page through its captured owner only while that owner and the caller's
 * intent remain current. Aborting acceptance does not cancel a shared network read or
 * weaken the owner's epoch/range fences. A cancelled in-flight read still returns its page.
 */
export async function fetchViewedTimelinePage(input: {
  agentId: string;
  fetchPage: () => Promise<TimelinePage>;
  getOwner: () => PageOwner | null | undefined;
  signal?: AbortSignal;
}): Promise<TimelinePage> {
  if (input.signal?.aborted) throw new Error("Timeline request cancelled");
  const owner = input.getOwner();
  const page = await input.fetchPage();
  if (!input.signal?.aborted && owner && input.getOwner() === owner) {
    owner.flushStreamAgent(input.agentId);
    owner.applyTimelineResponse(page);
  }
  return page;
}
