import { fetchViewedTimelinePage } from "./fetch-viewed-timeline-page";
import { expect, test, vi } from "vitest";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { fetchAgentTimelineOnce } from "./fetch-agent-timeline-once";

type TimelinePage = Awaited<ReturnType<DaemonClient["fetchAgentTimeline"]>>;

test("concurrent identical timeline reads share one request", async () => {
  let resolvePage: (page: TimelinePage) => void = () => {};
  const page = new Promise<TimelinePage>((resolve) => {
    resolvePage = resolve;
  });
  const requests: Array<{ agentId: string; direction: string }> = [];
  const client = {
    fetchAgentTimeline: async (
      agentId: string,
      request: Parameters<DaemonClient["fetchAgentTimeline"]>[1],
    ) => {
      requests.push({ agentId, direction: request?.direction ?? "tail" });
      return page;
    },
  };
  const request = { direction: "tail" as const, limit: 100, projection: "projected" as const };

  const first = fetchAgentTimelineOnce(client, "agent", request);
  const second = fetchAgentTimelineOnce(client, "agent", request);
  resolvePage({ hasNewer: false } as TimelinePage);

  await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  expect(requests).toEqual([{ agentId: "agent", direction: "tail" }]);
});

for (const olderFirst of [true, false]) {
  test(`cancelled navigation never applies its older window (older first: ${olderFirst})`, async () => {
    let releaseOlder!: (page: TimelinePage) => void;
    let releaseTail!: (page: TimelinePage) => void;
    const older = new Promise<TimelinePage>((resolve) => {
      releaseOlder = resolve;
    });
    const tail = new Promise<TimelinePage>((resolve) => {
      releaseTail = resolve;
    });
    const owner = { flushStreamAgent: vi.fn(), applyTimelineResponse: vi.fn() };
    const controller = new AbortController();
    const olderPage = { hasNewer: true } as TimelinePage;
    const tailPage = { hasNewer: false } as TimelinePage;
    const cancelled = fetchViewedTimelinePage({
      agentId: "agent",
      fetchPage: () => older,
      getOwner: () => owner,
      signal: controller.signal,
    });
    controller.abort();
    const latest = fetchViewedTimelinePage({
      agentId: "agent",
      fetchPage: () => tail,
      getOwner: () => owner,
    });
    if (olderFirst) {
      releaseOlder(olderPage);
      await cancelled;
      releaseTail(tailPage);
      await latest;
    } else {
      releaseTail(tailPage);
      await latest;
      releaseOlder(olderPage);
      await cancelled;
    }
    expect(owner.applyTimelineResponse.mock.calls).toEqual([[tailPage]]);
    expect(owner.flushStreamAgent).toHaveBeenCalledTimes(1);
  });
}

test("cancelling one shared read preserves unrelated acceptance and owner identity", async () => {
  let release!: (page: TimelinePage) => void;
  const shared = new Promise<TimelinePage>((resolve) => {
    release = resolve;
  });
  const original = { flushStreamAgent: vi.fn(), applyTimelineResponse: vi.fn() };
  const replacement = { flushStreamAgent: vi.fn(), applyTimelineResponse: vi.fn() };
  const controller = new AbortController();
  let current = original;
  const cancelled = fetchViewedTimelinePage({
    agentId: "agent",
    fetchPage: () => shared,
    getOwner: () => original,
    signal: controller.signal,
  });
  const unrelated = fetchViewedTimelinePage({
    agentId: "agent",
    fetchPage: () => shared,
    getOwner: () => original,
  });
  const replaced = fetchViewedTimelinePage({
    agentId: "agent",
    fetchPage: () => shared,
    getOwner: () => current,
  });
  controller.abort();
  current = replacement;
  release({ hasNewer: false } as TimelinePage);
  await Promise.all([cancelled, unrelated, replaced]);
  expect(original.applyTimelineResponse).toHaveBeenCalledTimes(1);
  expect(replacement.applyTimelineResponse).not.toHaveBeenCalled();
});

test("pre-cancelled acceptance makes no request", async () => {
  const controller = new AbortController();
  controller.abort();
  const fetchPage = vi.fn();
  await expect(
    fetchViewedTimelinePage({
      agentId: "agent",
      fetchPage,
      getOwner: () => null,
      signal: controller.signal,
    }),
  ).rejects.toThrow("cancelled");
  expect(fetchPage).not.toHaveBeenCalled();
});
