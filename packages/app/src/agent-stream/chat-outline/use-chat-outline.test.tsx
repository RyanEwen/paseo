// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamViewportHandle } from "../strategy";
import { PROMPT_DISCOVERY_PAGE_BUDGET } from "../use-prompt-discovery";
import { createPromptReadingPublisher } from "../prompt-reading-position";
import { usePromptNavigationControls } from "../use-prompt-navigation-controls";
import { useStickyPrompt } from "../use-sticky-prompt";
import type { StreamItem } from "@/types/stream";
import type { ChatOutline } from "./use-chat-outline";
import { createActivePromptPublisher } from "./model";
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

function stickyUser(id: string, seq: number): Extract<StreamItem, { kind: "user_message" }> {
  return {
    kind: "user_message",
    id,
    text: `Prompt ${seq}\n  preserve whitespace`,
    timestamp: new Date(0),
    timelineCursor: { epoch: "epoch-1", seq },
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
    expect(input.outline.jumpToPrompt).toHaveBeenCalledWith(2, { scroll: true });
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

  it("retries the intended latest indexed window before any prompt is loaded", async () => {
    const outline = stickyOutline([1]);
    const input = stickyInput([assistant], outline);
    const { result, rerender } = renderHook(useStickyPrompt, { initialProps: input });
    expect(outline.jumpToPrompt).toHaveBeenCalledWith(1, { scroll: false });
    rerender({ ...input, outline: { ...outline, jumpError: true } });
    await waitFor(() => expect(result.current.error).toBe(true));
    rerender(input);
    act(() => result.current.retry());
    expect(outline.jumpToPrompt).toHaveBeenCalledTimes(2);
    rerender({ ...input, items: [stickyUser("latest", 1), assistant] });
    await waitFor(() => expect(result.current.message?.id).toBe("latest"));
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
  await act(async () => content.resolve(loadedOlder));
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
