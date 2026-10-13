// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamViewportHandle } from "../strategy";
import { PROMPT_DISCOVERY_PAGE_BUDGET } from "../use-prompt-discovery";
import { createPromptReadingPublisher } from "../prompt-reading-position";
import { usePromptNavigationControls } from "../use-prompt-navigation-controls";
import * as protocolSchemas from "@getpaseo/protocol/messages";
import { createTimelineRequestLedger } from "../../../e2e/support/helpers/timeline-request-ledger";
import { useReadingPrompt } from "../use-reading-prompt";
import { useStickyPrompt } from "../use-sticky-prompt";
import type { StreamItem } from "@/types/stream";
import type { ChatOutline } from "./use-chat-outline";
import { shouldIndexUserPrompts, createActivePromptPublisher } from "./model";
import { useChatOutline } from "./use-chat-outline";

const runtime = vi.hoisted(() => ({
  listAgentTimelinePrompts: vi.fn(),
  fetchAgentTimeline: vi.fn(),
  subscribeAgentTimeline: vi.fn(() => {
    throw new Error("The outline must reuse the viewed timeline");
  }),
}));

vi.mock("@/constants/platform", () => ({ isWeb: true }));
vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({
    getClient: () => runtime,
    fetchAgentTimeline: runtime.fetchAgentTimeline,
  }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("useChatOutline", () => {
  beforeEach(() => {
    runtime.listAgentTimelinePrompts.mockReset();
    runtime.fetchAgentTimeline.mockReset();
    runtime.subscribeAgentTimeline.mockClear();
  });

  it("waits for a served timeline before requesting its prompt index", async () => {
    runtime.listAgentTimelinePrompts.mockResolvedValue({ epoch: "epoch-1", prompts: [] });
    const viewportRef = createRef<StreamViewportHandle>();
    const { rerender } = renderHook(
      ({ agentId, timelineEpoch }) =>
        useChatOutline({
          agentId,
          serverId: "server-1",
          timelineEpoch,
          tail: [],
          head: [],
          enabled: true,
          viewportRef,
          onJumpError: vi.fn(),
        }),
      { initialProps: { agentId: "draft_msg_1", timelineEpoch: null as string | null } },
    );

    expect(runtime.listAgentTimelinePrompts).not.toHaveBeenCalled();

    rerender({ agentId: "agent-1", timelineEpoch: "epoch-1" });
    await waitFor(() => expect(runtime.listAgentTimelinePrompts).toHaveBeenCalledTimes(1));
    expect(runtime.listAgentTimelinePrompts).toHaveBeenCalledWith("agent-1");
  });

  it("drops a late prompt index after the authoritative timeline epoch changes", async () => {
    const first = deferred<{ epoch: string; prompts: [] }>();
    const second = deferred<{
      epoch: string;
      prompts: Array<{ seq: number; timestamp: string; preview: string }>;
    }>();
    runtime.listAgentTimelinePrompts
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const viewportRef = createRef<StreamViewportHandle>();
    const { result, rerender } = renderHook(
      ({ timelineEpoch }) =>
        useChatOutline({
          agentId: "agent-1",
          serverId: "server-1",
          timelineEpoch,
          tail: [],
          head: [],
          enabled: true,
          viewportRef,
          onJumpError: vi.fn(),
        }),
      { initialProps: { timelineEpoch: "epoch-1" } },
    );
    await waitFor(() => expect(runtime.listAgentTimelinePrompts).toHaveBeenCalledTimes(1));

    rerender({ timelineEpoch: "epoch-2" });
    await waitFor(() => expect(runtime.listAgentTimelinePrompts).toHaveBeenCalledTimes(2));
    await act(async () => first.resolve({ epoch: "epoch-1", prompts: [] }));
    expect(result.current.prompts).toEqual([]);

    await act(async () =>
      second.resolve({
        epoch: "epoch-2",
        prompts: [{ seq: 2, timestamp: new Date(2).toISOString(), preview: "current prompt" }],
      }),
    );
    await waitFor(() => {
      expect(result.current.prompts).toHaveLength(1);
    });
    expect(result.current.prompts[0]?.seq).toBe(2);
  });

  it("refreshes from viewed user messages without another stream and keeps the newest index", async () => {
    const older = deferred<{
      epoch: string;
      prompts: Array<{ seq: number; timestamp: string; preview: string }>;
    }>();
    const newer = deferred<{
      epoch: string;
      prompts: Array<{ seq: number; timestamp: string; preview: string }>;
    }>();
    runtime.listAgentTimelinePrompts
      .mockResolvedValueOnce({ epoch: "epoch-1", prompts: [] })
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    const viewportRef = createRef<StreamViewportHandle>();
    const { result, rerender } = renderHook(
      ({ tail }) =>
        useChatOutline({
          agentId: "agent-1",
          serverId: "server-1",
          timelineEpoch: "epoch-1",
          tail,
          head: [],
          enabled: true,
          viewportRef,
          onJumpError: vi.fn(),
        }),
      { initialProps: { tail: [] as import("@/types/stream").StreamItem[] } },
    );
    await waitFor(() => expect(runtime.listAgentTimelinePrompts).toHaveBeenCalledTimes(1));
    const loadedPrompt = (seq: number): import("@/types/stream").StreamItem => ({
      id: `prompt-${seq}`,
      kind: "user_message",
      text: "live prompt",
      timestamp: new Date(seq),
      timelineCursor: { epoch: "epoch-1", seq },
    });
    rerender({ tail: [loadedPrompt(2)] });
    await waitFor(() => expect(runtime.listAgentTimelinePrompts).toHaveBeenCalledTimes(2));
    rerender({ tail: [loadedPrompt(2), loadedPrompt(3)] });
    await waitFor(() => expect(runtime.listAgentTimelinePrompts).toHaveBeenCalledTimes(3));
    await act(async () =>
      newer.resolve({
        epoch: "epoch-1",
        prompts: [{ seq: 3, timestamp: new Date(3).toISOString(), preview: "newer" }],
      }),
    );
    await act(async () =>
      older.resolve({
        epoch: "epoch-1",
        prompts: [{ seq: 2, timestamp: new Date(2).toISOString(), preview: "older" }],
      }),
    );

    expect(result.current.prompts.map((prompt) => prompt.seq)).toEqual([3]);
    expect(runtime.subscribeAgentTimeline).not.toHaveBeenCalled();
  });

  it("refreshes after reconnect catch-up and visibility changes without reacting to assistant chunks", async () => {
    runtime.listAgentTimelinePrompts.mockResolvedValue({
      epoch: "epoch-1",
      prompts: [{ seq: 1, timestamp: new Date(1).toISOString(), preview: "Unloaded prompt" }],
    });
    const viewportRef = createRef<StreamViewportHandle>();
    const { result, rerender } = renderHook(
      ({ enabled, head, timelineEpoch }) =>
        useChatOutline({
          agentId: "agent-1",
          serverId: "server-1",
          tail: [],
          head,
          timelineEpoch,
          enabled,
          viewportRef,
          visibleMessageIds: new Set(),
          onJumpError: vi.fn(),
        }),
      {
        initialProps: {
          enabled: true,
          head: [] as import("@/types/stream").StreamItem[],
          timelineEpoch: "epoch-1",
        },
      },
    );
    await waitFor(() => expect(result.current.prompts[0]?.preview).toBe("Unloaded prompt"));
    rerender({
      enabled: true,
      head: [
        {
          id: "assistant",
          kind: "assistant_message",
          text: "chunk",
          timestamp: new Date(),
          timelineCursor: { epoch: "epoch-1", seq: 2 },
        },
      ],
      timelineEpoch: "epoch-1",
    });
    expect(runtime.listAgentTimelinePrompts).toHaveBeenCalledTimes(1);
    rerender({ enabled: false, head: [], timelineEpoch: "epoch-1" });
    expect(result.current.prompts).toEqual([]);
    // The viewed model publishes the catch-up from the reconnected transport.
    runtime.listAgentTimelinePrompts.mockResolvedValue({
      epoch: "epoch-2",
      prompts: [{ seq: 1, timestamp: new Date(2).toISOString(), preview: "Replaced conversation" }],
    });
    rerender({
      enabled: true,
      head: [
        {
          id: "reconnected-user",
          kind: "user_message",
          text: "Replaced conversation",
          timestamp: new Date(2),
          timelineCursor: { epoch: "epoch-2", seq: 1 },
        },
      ],
      timelineEpoch: "epoch-2",
    });
    await waitFor(() => expect(result.current.prompts[0]?.preview).toBe("Replaced conversation"));
    expect(runtime.listAgentTimelinePrompts).toHaveBeenCalledTimes(2);
    expect(runtime.subscribeAgentTimeline).not.toHaveBeenCalled();
  });

  it("reports a failed unloaded prompt jump", async () => {
    runtime.listAgentTimelinePrompts.mockResolvedValue({
      epoch: "epoch-1",
      prompts: [{ seq: 1, timestamp: new Date(1).toISOString(), preview: "prompt" }],
    });
    runtime.fetchAgentTimeline.mockRejectedValue(new Error("disconnected"));
    const onJumpError = vi.fn();
    const viewportRef = createRef<StreamViewportHandle>();
    const { result } = renderHook(() =>
      useChatOutline({
        agentId: "agent-1",
        serverId: "server-1",
        timelineEpoch: "epoch-1",
        tail: [],
        head: [],
        enabled: true,
        viewportRef,
        onJumpError,
      }),
    );
    await waitFor(() => expect(result.current.prompts).toHaveLength(1));
    await act(async () => result.current.jumpToPrompt(1));

    await waitFor(() => expect(onJumpError).toHaveBeenCalledOnce());
  });

  it("reveals an already-loaded older prompt before scrolling to it", async () => {
    runtime.listAgentTimelinePrompts.mockResolvedValue({
      epoch: "epoch-1",
      prompts: [{ seq: 1, timestamp: new Date(1).toISOString(), preview: "prompt" }],
    });
    const scrollToMessage = vi.fn();
    const revealLoadedMessage = vi.fn(() => true);
    const viewport: StreamViewportHandle = {
      scrollToBottom: vi.fn(),
      prepareForViewportChange: vi.fn(),
      scrollToMessage,
    };
    const viewportRef = { current: viewport };
    const tail = [
      {
        id: "older-prompt",
        kind: "user_message" as const,
        text: "prompt",
        timestamp: new Date(1),
        timelineCursor: { epoch: "epoch-1", seq: 1 },
      },
    ];
    const { result, rerender } = renderHook(
      ({ visibleMessageIds }) =>
        useChatOutline({
          agentId: "agent-1",
          serverId: "server-1",
          timelineEpoch: "epoch-1",
          tail,
          head: [],
          enabled: true,
          viewportRef,
          onJumpError: vi.fn(),
          visibleMessageIds,
          revealLoadedMessage,
        }),
      { initialProps: { visibleMessageIds: new Set<string>() } },
    );

    await waitFor(() => expect(result.current.prompts).toHaveLength(1));
    await act(async () => result.current.jumpToPrompt(1));
    expect(revealLoadedMessage).toHaveBeenCalledWith("older-prompt");
    expect(scrollToMessage).not.toHaveBeenCalled();

    rerender({ visibleMessageIds: new Set(["older-prompt"]) });
    await waitFor(() => expect(scrollToMessage).toHaveBeenCalledWith("older-prompt"));
  });

  it("reveals a fetched prompt that lands outside the mounted history window", async () => {
    runtime.listAgentTimelinePrompts.mockResolvedValue({
      epoch: "epoch-1",
      prompts: [{ seq: 1, timestamp: new Date(1).toISOString(), preview: "prompt" }],
    });
    const fetch = deferred<void>();
    runtime.fetchAgentTimeline.mockReturnValue(fetch.promise);
    const scrollToMessage = vi.fn();
    const revealLoadedMessage = vi.fn(() => true);
    const viewportRef = {
      current: {
        scrollToBottom: vi.fn(),
        prepareForViewportChange: vi.fn(),
        scrollToMessage,
      },
    };
    const fetchedPrompt = {
      id: "fetched-prompt",
      kind: "user_message" as const,
      text: "prompt",
      timestamp: new Date(1),
      timelineCursor: { epoch: "epoch-1", seq: 1 },
    };
    const { result, rerender } = renderHook(
      ({ tail, visibleMessageIds }) =>
        useChatOutline({
          agentId: "agent-1",
          serverId: "server-1",
          timelineEpoch: "epoch-1",
          tail,
          head: [],
          enabled: true,
          viewportRef,
          onJumpError: vi.fn(),
          visibleMessageIds,
          revealLoadedMessage,
        }),
      {
        initialProps: {
          tail: [] as (typeof fetchedPrompt)[],
          visibleMessageIds: new Set<string>(),
        },
      },
    );

    await waitFor(() => expect(result.current.prompts).toHaveLength(1));
    act(() => result.current.jumpToPrompt(1));
    await waitFor(() => expect(runtime.fetchAgentTimeline).toHaveBeenCalledOnce());

    rerender({ tail: [fetchedPrompt], visibleMessageIds: new Set<string>() });
    await waitFor(() => expect(revealLoadedMessage).toHaveBeenCalledWith(fetchedPrompt.id));
    expect(scrollToMessage).not.toHaveBeenCalled();

    rerender({ tail: [fetchedPrompt], visibleMessageIds: new Set([fetchedPrompt.id]) });
    await waitFor(() => expect(scrollToMessage).toHaveBeenCalledOnce());
    expect(scrollToMessage).toHaveBeenCalledWith(fetchedPrompt.id);
    await act(async () => fetch.resolve());
    expect(result.current.jumpError).toBe(false);
    expect(result.current.isJumping).toBe(false);
  });

  it("jumps directly to a loaded prompt in the live head", async () => {
    runtime.listAgentTimelinePrompts.mockResolvedValue({
      epoch: "epoch-1",
      prompts: [{ seq: 2, timestamp: new Date(2).toISOString(), preview: "prompt" }],
    });
    const scrollToMessage = vi.fn();
    const viewport: StreamViewportHandle = {
      scrollToBottom: vi.fn(),
      prepareForViewportChange: vi.fn(),
      scrollToMessage,
    };
    const livePrompt = {
      id: "live-prompt",
      kind: "user_message" as const,
      text: "prompt",
      timestamp: new Date(2),
      timelineCursor: { epoch: "epoch-1", seq: 2 },
    };
    const revealLoadedMessage = vi.fn();
    revealLoadedMessage.mockReturnValue(false);
    const { result } = renderHook(() =>
      useChatOutline({
        agentId: "agent-1",
        serverId: "server-1",
        timelineEpoch: "epoch-1",
        tail: [],
        head: [livePrompt],
        enabled: true,
        viewportRef: { current: viewport },
        onJumpError: vi.fn(),
        visibleMessageIds: new Set([livePrompt.id]),
        revealLoadedMessage,
      }),
    );

    await waitFor(() => expect(result.current.prompts).toHaveLength(1));
    await act(async () => result.current.jumpToPrompt(2));
    expect(scrollToMessage).toHaveBeenCalledWith("live-prompt");
  });
});

function stickyUser(
  id: string,
  seq: number,
  epoch = "epoch-1",
): Extract<StreamItem, { kind: "user_message" }> {
  return {
    kind: "user_message",
    id,
    text: `Prompt ${seq}\n  preserve whitespace`,
    timestamp: new Date(0),
    timelineCursor: { epoch, seq },
  };
}

function stickyOutline(prompts = [1, 2, 3]): ChatOutline {
  return {
    prompts: prompts.map((seq) => ({
      seq,
      timestamp: new Date(0).toISOString(),
      preview: `Prompt ${seq}`,
    })),
    activePrompt: createActivePromptPublisher(),
    jumpToPrompt: vi.fn(),
    jumpToMessage: vi.fn(),
    reportReadingPosition: vi.fn(),
    isJumping: false,
    jumpError: false,
    indexReady: true,
    indexError: false,
    retryIndex: vi.fn(),
    cancelJump: vi.fn(),
    cancelStickyJump: vi.fn(),
    reportJumpError: vi.fn(),
  };
}

function stickyInput(items: StreamItem[], outline = stickyOutline()) {
  return {
    items,
    epoch: "epoch-1",
    outline,
    indexed: true,
    hasOlder: true,
    loadingOlder: false,
    progressKey: "initial",
    loadOlder: vi.fn(async () => false),
    jumpToLoaded: vi.fn(),
  };
}

describe("sticky user prompt navigation", () => {
  it("defaults to latest, navigates in order and follows incoming prompts intentionally", () => {
    const items = [stickyUser("one", 1), stickyUser("two", 2), stickyUser("three", 3)];
    const input = stickyInput(items);
    const { result, rerender } = renderHook(useStickyPrompt, { initialProps: input });
    expect(result.current.message).toEqual(items[2]);
    expect(result.current.nextDisabled).toBe(true);
    act(() => result.current.previous());
    expect(result.current.message).toEqual(items[1]);
    expect(input.jumpToLoaded).toHaveBeenLastCalledWith("two");
    const assistant: StreamItem = {
      kind: "assistant_message",
      id: "assistant",
      text: "Reply",
      timestamp: new Date(0),
    };
    rerender({ ...input, items: [...items, assistant, stickyUser("four", 4)] });
    expect(result.current.message).toEqual(items[1]);
    act(() => result.current.previous());
    expect(result.current.message).toEqual(items[0]);
    expect(result.current.previousDisabled).toBe(true);
    act(() => result.current.next());
    expect(result.current.message).toEqual(items[1]);
    act(() => result.current.followLatest());
    expect(result.current.message?.id).toBe("four");
    rerender({ ...input, items: [...items, stickyUser("five", 5)] });
    expect(result.current.message?.id).toBe("five");
  });

  it("holds the selection through an unloaded jump, reports failure and retries", async () => {
    const newest = stickyUser("three", 3);
    const input = stickyInput([newest]);
    const { result, rerender } = renderHook(useStickyPrompt, { initialProps: input });
    act(() => result.current.previous());
    expect(input.outline.jumpToPrompt).toHaveBeenCalledWith(2, { scroll: true, source: "sticky" });
    expect(result.current.busy).toBe(true);
    expect(result.current.message).toEqual(newest);
    rerender({ ...input, outline: { ...input.outline, jumpError: true } });
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.busy).toBe(false);
    rerender(input);
    act(() => result.current.retry());
    const older = stickyUser("two", 2);
    rerender({ ...input, items: [older, newest] });
    await waitFor(() => expect(result.current.message).toEqual(older));
    expect(result.current.busy).toBe(false);
  });

  it("preserves complete text and attachment identity and isolates independent panes", () => {
    const message = {
      ...stickyUser("one", 1),
      images: [{ id: "image" }],
      attachments: [{ id: "file" }],
    } as unknown as Extract<StreamItem, { kind: "user_message" }>;
    const input = stickyInput([message], stickyOutline([1]));
    const first = renderHook(useStickyPrompt, { initialProps: input });
    const second = renderHook(useStickyPrompt, {
      initialProps: stickyInput([], stickyOutline([])),
    });
    expect(first.result.current.message).toBe(message);
    expect(first.result.current.message?.images).toBe(message.images);
    expect(first.result.current.message?.attachments).toBe(message.attachments);
    expect(second.result.current.message).toBeUndefined();
    expect(second.result.current.previousDisabled).toBe(true);
    expect(second.result.current.nextDisabled).toBe(true);
  });

  it("does not loop when index-free pagination fails without advancing", async () => {
    const loadOlder = vi.fn(async () => true);
    const input = {
      ...stickyInput([stickyUser("three", 3)], stickyOutline([])),
      indexed: false,
      loadOlder,
    };
    const { result, rerender } = renderHook(useStickyPrompt, { initialProps: input });
    act(() => result.current.previous());
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(loadOlder).toHaveBeenCalledTimes(1);
    const older = stickyUser("one", 1);
    rerender({ ...input, items: [older, ...input.items] });
    act(() => result.current.retry());
    expect(result.current.message).toEqual(older);
  });
});

describe("sticky pagination across hidden history", () => {
  it("continues when the cursor advances without adding a visible prompt", async () => {
    const firstPage = deferred<boolean>();
    const secondPage = deferred<boolean>();
    const loadOlder = vi
      .fn()
      .mockReturnValueOnce(firstPage.promise)
      .mockReturnValueOnce(secondPage.promise);
    const input = {
      ...stickyInput([stickyUser("three", 3)], stickyOutline([])),
      indexed: false,
      loadOlder,
    };
    const { result, rerender } = renderHook(useStickyPrompt, { initialProps: input });
    act(() => result.current.previous());
    expect(loadOlder).toHaveBeenCalledTimes(1);
    // A hidden system/tool page moves the authoritative cursor without adding a user row.
    rerender({ ...input, progressKey: "older-page-1" });
    await act(async () => firstPage.resolve(true));
    await waitFor(() => expect(loadOlder).toHaveBeenCalledTimes(2));
    const older = stickyUser("one", 1);
    rerender({ ...input, progressKey: "older-page-2", items: [older, ...input.items] });
    await act(async () => secondPage.resolve(true));
    await waitFor(() => expect(result.current.message).toEqual(older));
    expect(result.current.error).toBe(false);
    expect(result.current.busy).toBe(false);
  });
});

/** A deferred page isolates navigation intent from the timeline owner's delivery. */
function cancelledJumpFixture() {
  runtime.listAgentTimelinePrompts.mockReset().mockResolvedValue({
    epoch: "epoch-1",
    prompts: [{ seq: 1, timestamp: new Date(0).toISOString(), preview: "old" }],
  });
  const page = deferred<void>();
  runtime.fetchAgentTimeline.mockReset().mockReturnValue(page.promise);
  const scrollToMessage = vi.fn();
  const cancelMessageScroll = vi.fn();
  const onJumpError = vi.fn();
  const input = {
    agentId: "agent-1",
    serverId: "server-1",
    timelineEpoch: "epoch-1",
    enabled: true,
    head: [],
    viewportRef: {
      current: {
        scrollToBottom: vi.fn(),
        prepareForViewportChange: vi.fn(),
        scrollToMessage,
        cancelMessageScroll,
      },
    },
    onJumpError,
  };
  const hook = renderHook(({ tail }) => useChatOutline({ ...input, tail }), {
    initialProps: { tail: [stickyUser("latest", 3)] as StreamItem[] },
  });
  return { ...hook, page, scrollToMessage, cancelMessageScroll, onJumpError };
}

describe("prompt jump acceptance and cancellation", () => {
  it("does not scroll or report failure after cancelling a held older window", async () => {
    const fixture = cancelledJumpFixture();
    await waitFor(() => expect(fixture.result.current.indexReady).toBe(true));
    act(() => fixture.result.current.jumpToPrompt(1));
    const acceptance = runtime.fetchAgentTimeline.mock.calls.at(-1)![3] as { signal: AbortSignal };
    expect(acceptance.signal.aborted).toBe(false);
    act(() => fixture.result.current.cancelJump());
    expect(acceptance.signal.aborted).toBe(true);
    fixture.rerender({ tail: [stickyUser("old", 1), stickyUser("latest", 3)] });
    await act(async () => fixture.page.resolve());
    expect(fixture.scrollToMessage).not.toHaveBeenCalled();
    expect(fixture.result.current.isJumping).toBe(false);
    expect(fixture.result.current.jumpError).toBe(false);
    expect(fixture.onJumpError).not.toHaveBeenCalled();
  });

  it("suppresses a cancelled request's late failure", async () => {
    const fixture = cancelledJumpFixture();
    await waitFor(() => expect(fixture.result.current.indexReady).toBe(true));
    act(() => fixture.result.current.jumpToPrompt(1));
    act(() => fixture.result.current.cancelJump());
    await act(async () => fixture.page.reject(new Error("late failure")));
    expect(fixture.onJumpError).not.toHaveBeenCalled();
    expect(fixture.result.current.jumpError).toBe(false);
  });

  it("settles an unloaded successful jump without exposing a failure", async () => {
    const fixture = cancelledJumpFixture();
    await waitFor(() => expect(fixture.result.current.indexReady).toBe(true));
    act(() => fixture.result.current.jumpToPrompt(1));
    fixture.rerender({ tail: [stickyUser("old", 1), stickyUser("latest", 3)] });
    await act(async () => fixture.page.resolve());
    await waitFor(() => expect(fixture.result.current.isJumping).toBe(false));
    expect(fixture.scrollToMessage).toHaveBeenCalledWith("old");
    expect(fixture.result.current.jumpError).toBe(false);
    expect(fixture.onJumpError).not.toHaveBeenCalled();
  });

  it("invalidates an already queued local-message animation frame", async () => {
    let frame: FrameRequestCallback | undefined;
    const cancelFrame = vi.fn();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frame = callback;
      return 17;
    });
    vi.stubGlobal("cancelAnimationFrame", cancelFrame);
    try {
      const fixture = cancelledJumpFixture();
      const local = { ...stickyUser("local", 4), timelineCursor: undefined };
      fixture.rerender({ tail: [local] });
      act(() => fixture.result.current.jumpToMessage("local"));
      act(() => fixture.result.current.cancelJump());
      act(() => frame!(0));
      expect(cancelFrame).toHaveBeenCalledWith(17);
      expect(fixture.scrollToMessage).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("initial prompt discovery", () => {
  const assistant = {
    kind: "assistant_message",
    id: "assistant",
    text: "Tool-only tail",
    timestamp: new Date(0),
  } as const;

  it("discovers the latest prompt past two pages without a user row", async () => {
    const pages = [deferred<boolean>(), deferred<boolean>(), deferred<boolean>()];
    const loadOlder = vi
      .fn()
      .mockReturnValueOnce(pages[0].promise)
      .mockReturnValueOnce(pages[1].promise)
      .mockReturnValueOnce(pages[2].promise);
    const input = { ...stickyInput([assistant], stickyOutline([])), indexed: false, loadOlder };
    const { result, rerender } = renderHook(useStickyPrompt, { initialProps: input });
    expect(result.current.message).toBeUndefined();
    expect(result.current.busy).toBe(true);
    rerender({ ...input, progressKey: "page-1" });
    await act(async () => pages[0].resolve(true));
    await waitFor(() => expect(loadOlder).toHaveBeenCalledTimes(2));
    rerender({ ...input, progressKey: "page-2" });
    await act(async () => pages[1].resolve(true));
    await waitFor(() => expect(loadOlder).toHaveBeenCalledTimes(3));
    const user = stickyUser("latest", 1);
    rerender({ ...input, progressKey: "page-3", items: [user, assistant] });
    await act(async () => pages[2].resolve(true));
    expect(result.current.message).toEqual(user);
    expect(result.current.busy).toBe(false);
    expect(input.jumpToLoaded).not.toHaveBeenCalled();
  });

  it("stops when history is exhausted", async () => {
    const page = deferred<boolean>();
    const loadOlder = vi.fn((_acceptance?: { signal: AbortSignal }) => page.promise);
    const input = { ...stickyInput([assistant], stickyOutline([])), indexed: false, loadOlder };
    const { result, rerender } = renderHook(useStickyPrompt, { initialProps: input });
    rerender({ ...input, hasOlder: false });
    await act(async () => page.resolve(true));
    expect(result.current.discoveryStatus).toBe("exhausted");
    expect(result.current.busy).toBe(false);
    expect(loadOlder).toHaveBeenCalledTimes(1);
  });

  it("shows failure without a prompt and retries the page", async () => {
    const loadOlder = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(false);
    const input = { ...stickyInput([assistant], stickyOutline([])), indexed: false, loadOlder };
    const { result } = renderHook(useStickyPrompt, { initialProps: input });
    await waitFor(() => expect(result.current.error).toBe(true));
    act(() => result.current.retry());
    await waitFor(() => expect(loadOlder).toHaveBeenCalledTimes(2));
    expect(result.current.message).toBeUndefined();
    await waitFor(() => expect(result.current.error).toBe(true));
  });

  it("cancels page acceptance and ignores its late completion", async () => {
    const page = deferred<boolean>();
    const loadOlder = vi.fn((_acceptance?: { signal: AbortSignal }) => page.promise);
    const input = { ...stickyInput([assistant], stickyOutline([])), indexed: false, loadOlder };
    const { result } = renderHook(useStickyPrompt, { initialProps: input });
    const acceptance = loadOlder.mock.calls[0]![0] as unknown as { signal: AbortSignal };
    act(() => result.current.cancel());
    expect(acceptance.signal.aborted).toBe(true);
    await act(async () => page.resolve(true));
    expect(loadOlder).toHaveBeenCalledTimes(1);
    expect(result.current.discoveryStatus).toBe("cancelled");
    expect(result.current.busy).toBe(false);
    expect(result.current.error).toBe(false);
  });

  it("limits a progressing history and lets the user explicitly continue", async () => {
    const pages = Array.from({ length: PROMPT_DISCOVERY_PAGE_BUDGET }, () => deferred<boolean>());
    let pageIndex = 0;
    const loadOlder = vi.fn(() => pages[pageIndex++].promise);
    const input = { ...stickyInput([assistant], stickyOutline([])), indexed: false, loadOlder };
    const { result, rerender } = renderHook(useStickyPrompt, { initialProps: input });
    for (let index = 0; index < PROMPT_DISCOVERY_PAGE_BUDGET; index += 1) {
      await waitFor(() => expect(loadOlder).toHaveBeenCalledTimes(index + 1));
      rerender({ ...input, progressKey: `page-${index + 1}` });
      await act(async () => pages[index].resolve(true));
    }
    expect(result.current.discoveryStatus).toBe("limited");
    expect(loadOlder).toHaveBeenCalledTimes(PROMPT_DISCOVERY_PAGE_BUDGET);
    loadOlder.mockImplementation(async () => false);
    act(() => result.current.retry());
    await waitFor(() => expect(loadOlder).toHaveBeenCalledTimes(PROMPT_DISCOVERY_PAGE_BUDGET + 1));
  });

  it("retries latest indexed content without loading a window before any prompt is loaded", async () => {
    const outline = stickyOutline([1]);
    const latest = stickyUser("latest", 1);
    const fetchPrompt = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(latest);
    const input = { ...stickyInput([assistant], outline), fetchPrompt };
    const { result } = renderHook(useStickyPrompt, { initialProps: input });
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(fetchPrompt).toHaveBeenCalledWith(1);
    expect(outline.jumpToPrompt).not.toHaveBeenCalled();
    expect(input.loadOlder).not.toHaveBeenCalled();
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.message).toEqual(latest));
    expect(fetchPrompt).toHaveBeenCalledTimes(2);
    expect(outline.jumpToPrompt).not.toHaveBeenCalled();
    expect(input.loadOlder).not.toHaveBeenCalled();
    expect(result.current.error).toBe(false);
  });
});

describe("viewport-owned sticky prompt", () => {
  it("hides while the original bubble intersects the viewport and follows manual reading", () => {
    const first = stickyUser("first", 1);
    const second = stickyUser("second", 3);
    const answer = {
      kind: "assistant_message" as const,
      text: "response",
      timestamp: new Date(2),
      id: "answer",
      timelineCursor: { epoch: "epoch-1", seq: 2 },
    };
    const reading = createPromptReadingPublisher();
    const input = { ...stickyInput([first, answer, second], stickyOutline([1, 3])), reading };
    const { result, rerender } = renderHook(useStickyPrompt, { initialProps: input });
    expect(result.current.message?.id).toBe("second");
    act(() => reading.publish(first.id, [first.id]));
    expect(result.current.message?.id).toBe("first");
    expect(result.current.stickyVisible).toBe(false);
    act(() =>
      reading.publish(first.id, [first.id], false, false, true, null, [
        { id: first.id, progress: 1 },
      ]),
    );
    expect(result.current.stickyVisible).toBe(true);
    expect(result.current.stickyProgress).toBe(1);
    act(() => reading.publish(first.id, [first.id]));
    expect(result.current.stickyVisible).toBe(false);
    act(() => reading.publish(answer.id));
    expect(result.current.stickyVisible).toBe(true);
    const incoming = stickyUser("third", 4);
    rerender({ ...input, items: [...input.items, incoming], outline: stickyOutline([1, 3, 4]) });
    expect(result.current.message?.id).toBe("first");
    act(() => reading.publish(second.id, [second.id]));
    expect(result.current.message?.id).toBe("second");
    expect(result.current.stickyVisible).toBe(false);
  });
  it("keeps an arrow target selected while smooth scrolling passes other prompts", () => {
    const users = [stickyUser("first", 1), stickyUser("second", 2), stickyUser("third", 3)];
    const reading = createPromptReadingPublisher();
    const input = { ...stickyInput(users, stickyOutline([1, 2, 3])), reading };
    const { result } = renderHook(useStickyPrompt, { initialProps: input });
    act(() => reading.publish(users[2]!.id, [users[2]!.id]));
    act(() => result.current.activate("third", -1));
    act(() => reading.publish("third", [], true));
    expect(result.current.message?.id).toBe("second");
    act(() => reading.publish("second", ["second"], false));
    expect(result.current.message?.id).toBe("second");
    expect(result.current.stickyVisible).toBe(false);
    expect(input.jumpToLoaded).toHaveBeenCalledWith("second");
  });
});

it("reads an unloaded active prompt without replacing or scrolling the viewport, and retries", async () => {
  const olderAnswer = {
    kind: "assistant_message" as const,
    id: "older-answer",
    text: "older response",
    timestamp: new Date(2),
    timelineCursor: { epoch: "epoch-1", seq: 2 },
  };
  const latest = stickyUser("latest", 3);
  const loadedOlder = stickyUser("old", 1);
  const reading = createPromptReadingPublisher();
  const content = deferred<typeof loadedOlder>();
  const fetchPrompt = vi
    .fn()
    .mockRejectedValueOnce(new Error("network"))
    .mockReturnValueOnce(content.promise);
  const input = {
    ...stickyInput([olderAnswer, latest], stickyOutline([1, 3])),
    reading,
    fetchPrompt,
  };
  const { result } = renderHook(useStickyPrompt, { initialProps: input });
  act(() => reading.publish(olderAnswer.id));
  await waitFor(() => expect(result.current.error).toBe(true));
  expect(result.current.message).toBeUndefined();
  act(() => result.current.retry());
  await waitFor(() => expect(fetchPrompt).toHaveBeenCalledTimes(2));
  const readingBeforeContent = reading.getSnapshot();
  await act(async () => content.resolve(loadedOlder));
  expect(reading.getSnapshot()).toBe(readingBeforeContent);
  expect(reading.getSnapshot()).toMatchObject({
    manual: true,
    following: false,
    navigating: false,
  });
  expect(input.items).toEqual([olderAnswer, latest]);
  expect(result.current.message).toEqual(loadedOlder);
  expect(result.current.stickyVisible).toBe(true);
  expect(result.current.error).toBe(false);
  expect(input.outline.jumpToPrompt).not.toHaveBeenCalled();
  expect(input.jumpToLoaded).not.toHaveBeenCalled();
  act(() => result.current.next());
  expect(input.jumpToLoaded).toHaveBeenCalledWith("latest");
});

it("ignores a late content-only read after return to latest and isolates new panes", async () => {
  const answer = {
    kind: "assistant_message" as const,
    id: "answer",
    text: "response",
    timestamp: new Date(2),
    timelineCursor: { epoch: "epoch-1", seq: 2 },
  };
  const latest = stickyUser("latest", 3);
  const old = stickyUser("old", 1);
  const content = deferred<typeof old>();
  const reading = createPromptReadingPublisher();
  const input = {
    ...stickyInput([answer, latest], stickyOutline([1, 3])),
    reading,
    fetchPrompt: vi.fn(() => content.promise),
  };
  const { result } = renderHook(useStickyPrompt, { initialProps: input });
  act(() => reading.publish(answer.id));
  await waitFor(() => expect(input.fetchPrompt).toHaveBeenCalledTimes(1));
  act(() => {
    result.current.followLatest();
    reading.publish(latest.id, [latest.id]);
  });
  await act(async () => content.resolve(old));
  expect(result.current.message?.id).toBe("latest");
  expect(result.current.error).toBe(false);
  const other = renderHook(useStickyPrompt, {
    initialProps: { ...input, reading: createPromptReadingPublisher() },
  });
  expect(other.result.current.message?.id).toBe("latest");
});

it("uses authoritative source positions for projected Markdown reading rows", () => {
  const older = stickyUser("older", 1);
  const latest = stickyUser("latest", 3);
  const reading = createPromptReadingPublisher();
  const input = { ...stickyInput([older, latest], stickyOutline([1, 3])), reading };
  const { result } = renderHook(useStickyPrompt, { initialProps: input });
  act(() => reading.publish("projected-markdown-block", [], false, false, true, 2));
  expect(result.current.message?.id).toBe("older");
  expect(result.current.stickyVisible).toBe(true);
  act(() => reading.publish("same-block", [], false, true, false, 2));
  expect(result.current.message?.id).toBe("latest");
});

it("does not transfer an arrow selection to a different reading-edge prompt after a clamped jump", () => {
  const users = [stickyUser("first", 1), stickyUser("second", 2), stickyUser("third", 3)];
  const reading = createPromptReadingPublisher();
  const input = { ...stickyInput(users, stickyOutline([1, 2, 3])), reading };
  const { result } = renderHook(useStickyPrompt, { initialProps: input });
  act(() => result.current.activate("third", -1));
  act(() => reading.publish("first", ["first", "second"], false, false, false, 1));
  expect(result.current.message?.id).toBe("second");
  expect(result.current.stickyVisible).toBe(false);
  act(() => reading.publish("first", ["first"], false, false, true, 1));
  expect(result.current.message?.id).toBe("first");
});

it("discovers an index-free reading prompt before the loaded window while retaining newer prompts", async () => {
  const olderAnswer = {
    kind: "assistant_message" as const,
    id: "answer",
    text: "response",
    timestamp: new Date(2),
    timelineCursor: { epoch: "epoch-1", seq: 2 },
  };
  const latest = stickyUser("latest", 3);
  const old = stickyUser("old", 1);
  const page = deferred<boolean>();
  const reading = createPromptReadingPublisher();
  const input = {
    ...stickyInput([olderAnswer, latest], stickyOutline([])),
    indexed: false,
    reading,
    loadOlder: vi.fn(() => page.promise),
  };
  const { result, rerender } = renderHook(useStickyPrompt, { initialProps: input });
  act(() => reading.publish(olderAnswer.id));
  await waitFor(() => expect(input.loadOlder).toHaveBeenCalledTimes(1));
  expect(result.current.message).toBeUndefined();
  rerender({ ...input, items: [old, olderAnswer, latest], progressKey: "older-page" });
  await act(async () => page.resolve(true));
  expect(result.current.message?.id).toBe("old");
  expect(result.current.stickyVisible).toBe(true);
});

it("preserves known attachment content when its indexed prompt leaves the loaded window", async () => {
  const old = {
    ...stickyUser("old", 1),
    images: [{ id: "image" }],
    attachments: [{ id: "file" }],
  } as unknown as Extract<StreamItem, { kind: "user_message" }>;
  const latest = stickyUser("latest", 3);
  const reading = createPromptReadingPublisher();
  const fetchPrompt = vi.fn();
  const input = { ...stickyInput([old, latest], stickyOutline([1, 3])), reading, fetchPrompt };
  const { result, rerender } = renderHook(useStickyPrompt, { initialProps: input });
  rerender({ ...input, items: [latest] });
  act(() => reading.publish("projected-old-response", [], false, false, true, 2));
  await waitFor(() => expect(result.current.message?.id).toBe("old"));
  expect(result.current.message?.images).toBe(old.images);
  expect(result.current.message?.attachments).toBe(old.attachments);
  expect(fetchPrompt).not.toHaveBeenCalled();
});

it("keeps original prompt controls stable during assistant streaming and updates when user targets change", () => {
  const first = stickyUser("first", 1);
  const answer = {
    id: "answer",
    kind: "assistant_message" as const,
    text: "first chunk",
    timestamp: new Date(2),
  };
  const input = stickyInput([first, answer], stickyOutline([1]));
  const { result, rerender } = renderHook(
    (props) => usePromptNavigationControls(useStickyPrompt(props)),
    { initialProps: input },
  );
  const initial = result.current;
  rerender({ ...input, items: [first, { ...answer, text: "continued streaming chunk" }] });
  expect(result.current).toBe(initial);
  rerender({
    ...input,
    items: [first, answer, stickyUser("next", 3)],
    outline: stickyOutline([1, 3]),
  });
  expect(result.current).not.toBe(initial);
  expect(result.current.targetIds).toEqual(["first", "next"]);
});

describe("sticky optional feature", () => {
  it("indexes only for a supported enabled consumer", () => {
    expect(shouldIndexUserPrompts(true, false, false)).toBe(false);
    expect(shouldIndexUserPrompts(true, true, false)).toBe(true);
    expect(shouldIndexUserPrompts(true, false, true)).toBe(true);
    expect(shouldIndexUserPrompts(false, true, true)).toBe(false);
  });
  it("does no discovery or navigation while disabled and restarts when enabled", async () => {
    const input = { ...stickyInput([], stickyOutline([])), indexed: false, enabled: false };
    const { result, rerender } = renderHook(useStickyPrompt, { initialProps: input });
    act(() => {
      result.current.retry();
      result.current.previous();
      result.current.reviewReading();
      result.current.followLatest();
    });
    expect(input.loadOlder).not.toHaveBeenCalled();
    expect(input.outline.jumpToPrompt).not.toHaveBeenCalled();
    expect(input.outline.cancelJump).not.toHaveBeenCalled();
    expect(result.current.stickyVisible).toBe(false);
    rerender({ ...input, enabled: true });
    await waitFor(() => expect(input.loadOlder).toHaveBeenCalledTimes(1));
  });
  it("invalidates held discovery without applying it or fetching again", async () => {
    const page = deferred<boolean>();
    const loadOlder = vi.fn((_acceptance?: { signal: AbortSignal }) => page.promise);
    const input = {
      ...stickyInput([], stickyOutline([])),
      indexed: false,
      loadOlder,
      enabled: true,
    };
    const { result, rerender } = renderHook(useStickyPrompt, { initialProps: input });
    const acceptance = loadOlder.mock.calls[0]![0]!;
    rerender({ ...input, enabled: false });
    expect(acceptance.signal.aborted).toBe(true);
    expect(input.outline.cancelStickyJump).toHaveBeenCalledTimes(1);
    expect(input.outline.cancelJump).not.toHaveBeenCalled();
    await act(async () => page.resolve(true));
    expect(result.current.stickyVisible).toBe(false);
    expect(loadOlder).toHaveBeenCalledTimes(1);
  });
  it("does not read missing content when disabled", async () => {
    const user = stickyUser("latest", 3);
    const answer = {
      kind: "assistant_message",
      id: "old-answer",
      text: "answer",
      timestamp: new Date(0),
      timelineCursor: { epoch: "epoch-1", seq: 2 },
    } as const;
    const reading = createPromptReadingPublisher();
    reading.publish(answer.id, [], false, false, true, 2);
    const fetchPrompt = vi.fn(() => deferred<ReturnType<typeof stickyUser>>().promise);
    const input = {
      ...stickyInput([answer, user], stickyOutline([1, 3])),
      enabled: false,
      reading,
      fetchPrompt,
    };
    const { result } = renderHook(useStickyPrompt, { initialProps: input });
    expect(fetchPrompt).not.toHaveBeenCalled();
    expect(result.current.stickyVisible).toBe(false);
  });
  it("cancels late content reads on opt-out and preserves loaded data", async () => {
    const user = { ...stickyUser("latest", 3), attachments: [{ id: "file" }] } as ReturnType<
      typeof stickyUser
    >;
    const answer = {
      kind: "assistant_message",
      id: "old-answer",
      text: "answer",
      timestamp: new Date(0),
      timelineCursor: { epoch: "epoch-1", seq: 2 },
    } as const;
    const reading = createPromptReadingPublisher();
    reading.publish(answer.id, [], false, false, true, 2);
    const page = deferred<ReturnType<typeof stickyUser>>();
    const fetchPrompt = vi.fn(() => page.promise);
    const input = {
      ...stickyInput([answer, user], stickyOutline([1, 3])),
      enabled: true,
      reading,
      fetchPrompt,
    };
    const { result, rerender } = renderHook(useStickyPrompt, { initialProps: input });
    expect(fetchPrompt).toHaveBeenCalledTimes(1);
    rerender({ ...input, enabled: false });
    await act(async () => page.resolve(stickyUser("old", 1)));
    expect(result.current.stickyVisible).toBe(false);
    expect(result.current.message).toBe(user);
    expect(result.current.message?.attachments).toBe(user.attachments);
    act(() => reading.publish(user.id, [user.id], false, true));
    rerender({ ...input, enabled: true });
    expect(result.current.message).toBe(user);
    expect(fetchPrompt).toHaveBeenCalledTimes(1);
  });
  it("cancels sticky window acceptance without cancelling an outline-owned jump", async () => {
    const fixture = cancelledJumpFixture();
    await waitFor(() => expect(fixture.result.current.indexReady).toBe(true));
    act(() => fixture.result.current.jumpToPrompt(1, { source: "sticky" }));
    const stickyAcceptance = runtime.fetchAgentTimeline.mock.calls.at(-1)![3] as {
      signal: AbortSignal;
    };
    act(() => fixture.result.current.cancelStickyJump!());
    expect(stickyAcceptance.signal.aborted).toBe(true);
    act(() => fixture.result.current.jumpToPrompt(1));
    const outlineAcceptance = runtime.fetchAgentTimeline.mock.calls.at(-1)![3] as {
      signal: AbortSignal;
    };
    act(() => fixture.result.current.cancelStickyJump!());
    expect(outlineAcceptance.signal.aborted).toBe(false);
    expect(fixture.result.current.isJumping).toBe(true);
    await act(async () => fixture.page.resolve());
  });
});

it("lets a newer original cover an older sticky copy before replacing it", () => {
  const first = stickyUser("first", 1);
  const second = stickyUser("second", 3);
  const reading = createPromptReadingPublisher();
  const input = { ...stickyInput([first, second], stickyOutline([1, 3])), reading };
  const { result } = renderHook(useStickyPrompt, { initialProps: input });
  act(() =>
    reading.publish(first.id, [second.id], false, false, true, 1, [
      { id: second.id, progress: 0, top: 60 },
    ]),
  );
  expect(result.current.message?.id).toBe(first.id);
  expect(result.current.occlusionTop).toBe(60);
  act(() =>
    reading.publish(first.id, [second.id], false, false, true, 1, [
      { id: second.id, progress: 0, top: 12 },
    ]),
  );
  expect(result.current.occlusionTop).toBe(12);
  act(() =>
    reading.publish(second.id, [second.id], false, false, true, 3, [
      { id: second.id, progress: 1, top: -24 },
    ]),
  );
  expect(result.current.message?.id).toBe(second.id);
  expect(result.current.occlusionTop).toBeUndefined();
});

it("preserves measured bubble placement through virtualization and invalidates it on resize", () => {
  const user = stickyUser("prompt", 1);
  const reading = createPromptReadingPublisher();
  const input = { ...stickyInput([user], stickyOutline([1])), reading };
  const { result } = renderHook(useStickyPrompt, { initialProps: input });
  act(() =>
    reading.publish(
      user.id,
      [user.id],
      false,
      false,
      true,
      1,
      [
        {
          id: user.id,
          progress: 1,
          top: 0,
          left: 180,
          width: 120,
          viewportWidth: 320,
          prefixHeightOne: 20,
          prefixHeightTwo: 20,
        },
      ],
      320,
    ),
  );
  expect(result.current.geometry).toMatchObject({ left: 180, width: 120, viewportWidth: 320 });
  act(() => reading.publish("answer", [], false, false, true, 2, [], 320));
  expect(result.current.geometry).toMatchObject({ left: 180, width: 120, viewportWidth: 320 });
  act(() => reading.publish("answer", [], false, false, true, 2, [], 480));
  expect(result.current.geometry).toBeUndefined();
});

describe("return to the pinned prompt", () => {
  it("reveals this loaded prompt rather than an adjacent one and retains it through incoming prompts", () => {
    const latest = stickyUser("three", 3);
    const reading = createPromptReadingPublisher();
    const input = { ...stickyInput([latest]), reading };
    const { result, rerender } = renderHook(useStickyPrompt, { initialProps: input });
    act(() => result.current.reveal());
    expect(input.jumpToLoaded).toHaveBeenCalledWith(latest.id);
    expect(input.outline.jumpToPrompt).not.toHaveBeenCalled();
    act(() => reading.publish(latest.id, [latest.id], false, false, false, 3));
    const incoming = stickyUser("four", 4);
    rerender({ ...input, items: [latest, incoming], outline: stickyOutline([1, 2, 3, 4]) });
    expect(result.current.message?.id).toBe(latest.id);
    act(() => result.current.followLatest());
    expect(result.current.message?.id).toBe(incoming.id);
  });
  it("loads the indexed current prompt when only its response is in the window", async () => {
    const old = stickyUser("one", 1);
    const latest = stickyUser("three", 3);
    const answer = {
      kind: "assistant_message",
      id: "answer",
      text: "response",
      timestamp: new Date(0),
      timelineCursor: { epoch: "epoch-1", seq: 2 },
    } as const;
    const reading = createPromptReadingPublisher();
    reading.publish(answer.id, [], false, false, true, 2);
    const input = {
      ...stickyInput([answer, latest], stickyOutline([1, 3])),
      reading,
      fetchPrompt: vi.fn(async () => old),
    };
    const { result, rerender } = renderHook(useStickyPrompt, { initialProps: input });
    await waitFor(() => expect(result.current.message?.id).toBe(old.id));
    act(() => result.current.reveal());
    expect(input.outline.jumpToPrompt).toHaveBeenCalledWith(1, { scroll: true, source: "sticky" });
    expect(result.current.busy).toBe(true);
    act(() => result.current.reveal());
    expect(input.outline.jumpToPrompt).toHaveBeenCalledTimes(1);
    rerender({ ...input, items: [old, answer, latest] });
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current.message?.id).toBe(old.id);
  });
  it("does not navigate from an empty, loading or disabled surface", () => {
    const user = stickyUser("three", 3);
    const input = stickyInput([user]);
    const { result, rerender } = renderHook(useStickyPrompt, {
      initialProps: { ...input, enabled: true },
    });
    rerender({ ...input, enabled: true, outline: { ...input.outline, isJumping: true } });
    act(() => result.current.reveal());
    rerender({ ...input, enabled: false });
    act(() => result.current.reveal());
    expect(input.jumpToLoaded).not.toHaveBeenCalled();
    const empty = renderHook(useStickyPrompt, { initialProps: stickyInput([], stickyOutline([])) });
    act(() => empty.result.current.reveal());
    expect(empty.result.current.message).toBeUndefined();
  });
});

describe("prompt ownership across authoritative epochs", () => {
  it("clears an earlier selection and pending jump without scrolling the retained viewport", () => {
    const input = stickyInput(
      [stickyUser("one", 1), stickyUser("three", 3)],
      stickyOutline([0, 1, 3]),
    );
    const { result, rerender } = renderHook(useStickyPrompt, { initialProps: input });
    act(() => result.current.previous());
    expect(result.current.message?.id).toBe("one");
    act(() => result.current.previous());
    expect(result.current.busy).toBe(true);
    const cancellationCount = vi.mocked(input.outline.cancelStickyJump).mock.calls.length;
    const latest = { ...stickyUser("three", 3, "epoch-2"), text: "Replacement latest" };
    rerender({ ...input, epoch: "epoch-2", items: [stickyUser("one", 1, "epoch-2"), latest] });
    expect(result.current.message).toEqual(latest);
    expect(result.current.busy).toBe(false);
    expect(result.current.error).toBe(false);
    expect(input.outline.cancelStickyJump).toHaveBeenCalledTimes(cancellationCount + 1);
    expect(input.jumpToLoaded).toHaveBeenCalledTimes(1);
  });

  it("fences a held old-epoch read while fetching the same sequence in the new epoch", async () => {
    const old = deferred<ReturnType<typeof stickyUser>>();
    const fresh = deferred<ReturnType<typeof stickyUser>>();
    const fetchPrompt = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const input = {
      seq: 1,
      epoch: "epoch-1",
      knownPrompts: [] as ReturnType<typeof stickyUser>[],
      fetchPrompt,
    };
    const { result, rerender } = renderHook(useReadingPrompt, { initialProps: input });
    rerender({ ...input, epoch: "epoch-2" });
    expect(fetchPrompt).toHaveBeenCalledTimes(2);
    await act(async () => old.resolve(stickyUser("same", 1)));
    expect(result.current.item).toBeUndefined();
    expect(result.current.loading).toBe(true);
    const replacement = { ...stickyUser("same", 1, "epoch-2"), text: "Fresh content" };
    await act(async () => fresh.resolve(replacement));
    expect(result.current.item).toEqual(replacement);
    expect(result.current.error).toBe(false);
  });

  it("does not reuse resolved content when an epoch reuses the same prompt identity", async () => {
    const old = stickyUser("same", 1);
    const replacement = { ...stickyUser("same", 1, "epoch-2"), text: "Fresh content" };
    const fetchPrompt = vi.fn().mockResolvedValueOnce(old).mockResolvedValueOnce(replacement);
    const input = {
      seq: 1,
      epoch: "epoch-1",
      knownPrompts: [] as ReturnType<typeof stickyUser>[],
      fetchPrompt,
    };
    const { result, rerender } = renderHook(useReadingPrompt, { initialProps: input });
    await waitFor(() => expect(result.current.item).toEqual(old));
    rerender({ ...input, epoch: "epoch-2" });
    await waitFor(() => expect(result.current.item).toEqual(replacement));
    expect(fetchPrompt).toHaveBeenCalledTimes(2);
  });
});

/** Use the real advertised feature and canonical index to exercise the test gate's contract. */
function indexedReadLedger() {
  const ledger = createTimelineRequestLedger("agent", protocolSchemas);
  ledger.observe(
    { type: "status" },
    { status: "server_info", features: { agentTimelinePromptIndex: true } },
  );
  ledger.observe(
    { type: "agent.timeline.list_prompts.response" },
    {
      requestId: "index",
      agentId: "agent",
      epoch: "epoch",
      prompts: [1, 3].map((seq) => ({
        seq,
        timestamp: new Date(0).toISOString(),
        preview: `Prompt ${seq}`,
      })),
      error: null,
    },
  );
  return ledger;
}

function contentReadRequest(requestId = "content") {
  return {
    type: "fetch_agent_timeline_request",
    agentId: "agent",
    requestId,
    direction: "before",
    cursor: { epoch: "epoch", seq: 2 },
    limit: 1,
    projection: "projected",
  };
}

function contentReadResponse(type = "user_message") {
  return {
    requestId: "content",
    agentId: "agent",
    agent: null,
    direction: "before",
    epoch: "epoch",
    projection: "projected",
    reset: false,
    staleCursor: false,
    gap: false,
    window: { minSeq: 1, maxSeq: 3, nextSeq: 4 },
    hasOlder: false,
    hasNewer: true,
    startCursor: { epoch: "epoch", seq: 1 },
    endCursor: { epoch: "epoch", seq: 1 },
    entries: [
      {
        provider: "mock",
        timestamp: new Date(0).toISOString(),
        seqStart: 1,
        seqEnd: 1,
        sourceSeqRanges: [{ startSeq: 1, endSeq: 1 }],
        collapsed: [],
        item: { type, text: "Prompt 1" },
      },
    ],
    error: null,
  };
}

describe("explicit history-window and indexed-content accounting", () => {
  it("accounts for every request without consuming a held window slot for canonical content", () => {
    const ledger = indexedReadLedger();
    expect(ledger.classify({ ...contentReadRequest("window"), limit: 40 })).toBe("window");
    expect(ledger.classify(contentReadRequest())).toBe("content");
    expect(
      ledger.beforeResponsePurpose({ requestId: "window", agentId: "agent", direction: "before" }),
    ).toBe("window");
    expect(
      ledger.beforeResponsePurpose({ requestId: "content", agentId: "agent", direction: "before" }),
    ).toBe("content");
    ledger.completeContent(contentReadResponse());
    expect(ledger.summary()).toEqual({
      allBefore: 2,
      windowBefore: 1,
      contentBefore: 1,
      pendingContent: 0,
      errors: [],
    });
  });

  it("rejects cache-shaped reads without an advertised capability and canonical index", () => {
    const ledger = createTimelineRequestLedger("agent", protocolSchemas);
    expect(ledger.classify(contentReadRequest())).toBeUndefined();
    expect(ledger.summary().allBefore).toBe(1);
    expect(ledger.summary().errors).toHaveLength(1);
  });

  it.each([
    { limit: 2 },
    { projection: "canonical" },
    { mergeWindow: true },
    { cursor: { epoch: "epoch", seq: 3 } },
    { cursor: { epoch: "stale", seq: 2 } },
  ])("rejects unclassified before request %j instead of silently filtering it", (invalid) => {
    const ledger = indexedReadLedger();
    expect(ledger.classify({ ...contentReadRequest(), ...invalid })).toBeUndefined();
    expect(ledger.summary()).toMatchObject({ allBefore: 1, windowBefore: 0, contentBefore: 0 });
    expect(ledger.summary().errors).toHaveLength(1);
  });

  it("rejects a second read of the same indexed prompt in the same epoch", () => {
    const ledger = indexedReadLedger();
    expect(ledger.classify(contentReadRequest())).toBe("content");
    ledger.completeContent(contentReadResponse());
    expect(ledger.classify(contentReadRequest("duplicate"))).toBeUndefined();
    expect(ledger.summary()).toMatchObject({ allBefore: 2, windowBefore: 0, contentBefore: 1 });
    expect(ledger.summary().errors).toHaveLength(1);
  });

  it("rejects content already present in delivered authoritative pages", () => {
    const ledger = indexedReadLedger();
    ledger.observeWindow(contentReadResponse());
    expect(ledger.classify(contentReadRequest())).toBeUndefined();
    expect(ledger.summary().errors).toHaveLength(1);
  });

  it("rejects a non-user content response and an unclassified response identity", () => {
    const ledger = indexedReadLedger();
    expect(ledger.classify(contentReadRequest())).toBe("content");
    ledger.completeContent(contentReadResponse("assistant_message"));
    expect(
      ledger.beforeResponsePurpose({ requestId: "unknown", agentId: "agent", direction: "before" }),
    ).toBeUndefined();
    expect(ledger.summary().errors).toHaveLength(2);
  });
});

it.each([null, {}, { seqStart: 1, seqEnd: 1 }, { seqStart: 1, seqEnd: 1, item: null }])(
  "records malformed cache entry %j instead of escaping the socket callback",
  (entry) => {
    const ledger = indexedReadLedger();
    ledger.classify(contentReadRequest());
    expect(() =>
      ledger.completeContent({ ...contentReadResponse(), entries: [entry] }),
    ).not.toThrow();
    expect(ledger.summary()).toMatchObject({
      pendingContent: 0,
      errors: ["Malformed canonical prompt-content response"],
    });
  },
);

it.each([
  { agentId: "other" },
  { direction: "after" },
  { startCursor: { epoch: "other", seq: 1 } },
  { endCursor: { epoch: "epoch", seq: 2 } },
  { entries: [] },
])("rejects invalid canonical content identity %j", (invalid) => {
  const ledger = indexedReadLedger();
  ledger.classify(contentReadRequest());
  ledger.completeContent({ ...contentReadResponse(), ...invalid });
  expect(ledger.summary().errors).toHaveLength(1);
});

it("rejects a malformed canonical index before trusting its sequence identity", () => {
  const ledger = indexedReadLedger();
  ledger.observe(
    { type: "agent.timeline.list_prompts.response" },
    { requestId: "broken", agentId: "agent", epoch: "epoch", prompts: [null], error: null },
  );
  expect(ledger.classify(contentReadRequest())).toBeUndefined();
  expect(ledger.summary().errors).toHaveLength(2);
});

describe("passive indexed latest prompt content", () => {
  it("keeps assistant-only history and following intact, then loads and scrolls only for explicit review", async () => {
    runtime.listAgentTimelinePrompts.mockReset().mockResolvedValue({
      epoch: "epoch-1",
      prompts: [{ seq: 1, timestamp: new Date(0).toISOString(), preview: "Latest prompt" }],
    });
    const window = deferred<void>();
    runtime.fetchAgentTimeline.mockReset().mockReturnValue(window.promise);
    const content = deferred<ReturnType<typeof stickyUser>>();
    const fetchPrompt = vi.fn(() => content.promise);
    const assistant: StreamItem = {
      kind: "assistant_message",
      id: "tail-answer",
      text: "Current tail",
      timestamp: new Date(0),
      timelineCursor: { epoch: "epoch-1", seq: 206 },
    };
    const reading = createPromptReadingPublisher();
    reading.publish(assistant.id, [], false, true, false, 206);
    const before = reading.getSnapshot();
    const scrollToMessage = vi.fn();
    const viewportRef = {
      current: {
        scrollToBottom: vi.fn(),
        prepareForViewportChange: vi.fn(),
        scrollToMessage,
        cancelMessageScroll: vi.fn(),
      },
    };
    const loadOlder = vi.fn(async () => false);
    const jumpToLoaded = vi.fn();
    const tail: StreamItem[] = [assistant];
    const { result, rerender } = renderHook(
      ({ items }) => {
        const outline = useChatOutline({
          agentId: "agent",
          serverId: "server",
          timelineEpoch: "epoch-1",
          enabled: true,
          tail: items,
          head: [],
          viewportRef,
          onJumpError: vi.fn(),
        });
        const sticky = useStickyPrompt({
          ...stickyInput(items, outline),
          reading,
          fetchPrompt,
          loadOlder,
          jumpToLoaded,
        });
        return { outline, sticky };
      },
      { initialProps: { items: tail } },
    );
    await waitFor(() => expect(result.current.outline.indexReady).toBe(true));
    expect(runtime.fetchAgentTimeline).not.toHaveBeenCalled();
    await waitFor(() => expect(fetchPrompt).toHaveBeenCalledTimes(1));
    expect(loadOlder).not.toHaveBeenCalled();
    expect(scrollToMessage).not.toHaveBeenCalled();
    const prompt = {
      ...stickyUser("latest", 1),
      text: "Latest prompt\n  formatting retained",
      images: [{ id: "image" }],
      attachments: [{ id: "file" }],
    } as ReturnType<typeof stickyUser>;
    await act(async () => content.resolve(prompt));
    expect(result.current.sticky.message).toEqual(prompt);
    expect(reading.getSnapshot()).toBe(before);
    expect(tail).toEqual([assistant]);
    expect(runtime.fetchAgentTimeline).not.toHaveBeenCalled();
    act(() => result.current.sticky.reveal());
    expect(runtime.fetchAgentTimeline).toHaveBeenCalledTimes(1);
    expect(runtime.fetchAgentTimeline).toHaveBeenCalledWith(
      "server",
      "agent",
      {
        direction: "before",
        cursor: { epoch: "epoch-1", seq: 22 },
        limit: 40,
        projection: "projected",
        mergeWindow: true,
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(scrollToMessage).not.toHaveBeenCalled();
    expect(jumpToLoaded).not.toHaveBeenCalled();
    expect(result.current.sticky.message).toEqual(prompt);
    rerender({ items: [prompt, assistant] });
    await waitFor(() => expect(scrollToMessage).toHaveBeenCalledWith("latest"));
    await act(async () => window.resolve());
    expect(scrollToMessage).toHaveBeenCalledTimes(1);
    expect(result.current.sticky.busy).toBe(false);
    expect(result.current.sticky.error).toBe(false);
    expect(reading.getSnapshot()).toBe(before);
  });
});
