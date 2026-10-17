import { useNavigationActionVisibility } from "../use-navigation-action-visibility";
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
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import {
  fetchReadingPromptContext,
  childContextPageReader,
  type ContextPage,
  type ContextEntry,
} from "../fetch-reading-prompt-context";
import type { UserPrompt } from "../sticky-prompt-model";
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

  it("routes loaded pinned placement while default outline navigation keeps the original landing", () => {
    const scrollToMessage = vi.fn();
    const viewportRef = createRef<StreamViewportHandle>();
    viewportRef.current = {
      scrollToMessage,
      scrollToBottom: vi.fn(),
      prepareForViewportChange: vi.fn(),
    };
    const { result } = renderHook(() =>
      useChatOutline({
        agentId: "agent-1",
        serverId: "server-1",
        timelineEpoch: "epoch-1",
        tail: [stickyUser("one", 1)],
        head: [],
        enabled: false,
        viewportRef,
        onJumpError: vi.fn(),
      }),
    );
    act(() => result.current.jumpToPrompt(1, { source: "sticky", placement: "pinned" }));
    expect(scrollToMessage).toHaveBeenLastCalledWith("one", undefined, "pinned");
    act(() => result.current.jumpToMessage("one"));
    expect(scrollToMessage).toHaveBeenLastCalledWith("one");
    act(() => result.current.jumpToPrompt(1, { scroll: false, placement: "pinned" }));
    expect(scrollToMessage).toHaveBeenCalledTimes(2);
  });

  it("retains unloaded pinned placement until its authoritative row loads", async () => {
    runtime.listAgentTimelinePrompts.mockResolvedValue({
      epoch: "epoch-1",
      prompts: [{ seq: 2, timestamp: new Date(2).toISOString(), preview: "two" }],
    });
    const held = deferred<void>();
    runtime.fetchAgentTimeline.mockReturnValue(held.promise);
    const scrollToMessage = vi.fn();
    const viewportRef = createRef<StreamViewportHandle>();
    viewportRef.current = {
      scrollToMessage,
      scrollToBottom: vi.fn(),
      prepareForViewportChange: vi.fn(),
    };
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
      { initialProps: { tail: [stickyUser("one", 1)] as StreamItem[] } },
    );
    await waitFor(() => expect(result.current.prompts).toHaveLength(1));
    act(() => result.current.jumpToPrompt(2, { source: "sticky", placement: "pinned" }));
    expect(scrollToMessage).not.toHaveBeenCalled();
    rerender({ tail: [stickyUser("one", 1), stickyUser("two", 2)] });
    await waitFor(() => expect(scrollToMessage).toHaveBeenCalledWith("two", undefined, "pinned"));
    await act(async () => held.resolve());
    expect(scrollToMessage).toHaveBeenCalledTimes(1);
    expect(result.current.jumpError).toBe(false);
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
    expect(input.jumpToLoaded).toHaveBeenLastCalledWith("two", "pinned");
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
    expect(input.outline.jumpToPrompt).toHaveBeenCalledWith(2, {
      scroll: true,
      source: "sticky",
      placement: "pinned",
    });
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
    expect(fixture.scrollToMessage).toHaveBeenCalledTimes(1);
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
    expect(input.jumpToLoaded).toHaveBeenCalledWith("second", "pinned");
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
  expect(input.jumpToLoaded).toHaveBeenCalledWith("latest", "pinned");
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

it("reads index-free context without applying an older viewed window", async () => {
  const answer = {
    kind: "assistant_message" as const,
    id: "answer",
    text: "response",
    timestamp: new Date(2),
    timelineCursor: { epoch: "epoch-1", seq: 2 },
  };
  const old = stickyUser("old", 1);
  const latest = stickyUser("latest", 3);
  const reading = createPromptReadingPublisher();
  const held = deferred<typeof old | undefined>();
  const fetchContext = vi.fn((_source: StreamItem, _signal: AbortSignal) => held.promise);
  const ownerPage = deferred<boolean>();
  const input = {
    ...stickyInput([answer, latest], stickyOutline([])),
    indexed: false,
    reading,
    fetchContext,
    loadOlder: vi.fn(() => ownerPage.promise),
  };
  const { result, rerender } = renderHook(useStickyPrompt, { initialProps: input });
  act(() => reading.publish(answer.id));
  expect(input.loadOlder).not.toHaveBeenCalled();
  await waitFor(() => expect(fetchContext).toHaveBeenCalledTimes(1));
  expect(input.loadOlder).not.toHaveBeenCalled();
  await act(async () => held.resolve(old));
  expect(result.current.message?.id).toBe("old");
  expect(result.current.stickyVisible).toBe(true);
  expect(input.outline.jumpToPrompt).not.toHaveBeenCalled();
  expect(reading.getSnapshot().rowId).toBe("answer");
  act(() => result.current.reveal());
  await waitFor(() => expect(input.loadOlder).toHaveBeenCalledTimes(1));
  expect(input.jumpToLoaded).not.toHaveBeenCalled();
  rerender({ ...input, items: [old, answer, latest], progressKey: "older" });
  await act(async () => ownerPage.resolve(true));
  await waitFor(() => expect(input.jumpToLoaded).toHaveBeenCalledWith("old", "original"));
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
    expect(input.jumpToLoaded).toHaveBeenCalledWith(latest.id, "original");
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
    expect(input.outline.jumpToPrompt).toHaveBeenCalledWith(1, {
      scroll: true,
      source: "sticky",
      placement: "original",
    });
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

// Ranges and shared message identity are captured from the old-host response.
// Predecessor USER and intervening pages below are synthetic boundary fixtures.
describe("index-free cache-only context", () => {
  const source: StreamItem = {
    kind: "assistant_message",
    id: "segment-256",
    messageId: "same",
    text: "answer",
    timestamp: new Date(0),
    timelineCursor: { epoch: "epoch", seq: 256 },
  };
  const entry = (start: number, end: number, type = "assistant_message"): ContextEntry => ({
    provider: "mock",
    timestamp: new Date(0).toISOString(),
    seqStart: start,
    seqEnd: end,
    sourceSeqRanges: [{ startSeq: start, endSeq: end }],
    collapsed: [],
    item:
      type === "user_message"
        ? { type: "user_message", text: "original prompt" }
        : { type: "assistant_message", messageId: "same", text: "answer" },
  });
  const page = (entries: ContextEntry[], hasOlder = true): ContextPage => ({
    epoch: "epoch",
    entries,
    hasOlder,
    error: null,
    reset: false,
    staleCursor: false,
    gap: false,
  });

  it("separates shared messageId occurrences and walks true expanded source starts", async () => {
    const reader = vi
      .fn()
      .mockResolvedValueOnce(page([entry(246, 256)]))
      .mockResolvedValueOnce(page([entry(220, 242)]))
      .mockResolvedValueOnce(page([entry(212, 217)]))
      .mockResolvedValueOnce(page([entry(63, 63, "user_message"), entry(64, 64, "user_message")]));
    const prompt = await fetchReadingPromptContext(reader, source, new AbortController().signal);
    expect(prompt?.timelineCursor).toEqual({ epoch: "epoch", seq: 64 });
    expect(prompt?.text).toBe("original prompt");
    expect(
      reader.mock.calls.map(([request]) => [request.cursor, request.limit, request.projection]),
    ).toEqual([
      [257, 1, "projected"],
      [246, 40, "canonical"],
      [220, 40, "canonical"],
      [212, 40, "canonical"],
    ]);
  });

  it("counts the source probe inside the eight-read cap", async () => {
    let end = 246;
    const reader = vi
      .fn()
      .mockImplementation(async (request) =>
        request.limit === 1 ? page([entry(246, 256)]) : page([entry(--end, end)]),
      );
    await expect(
      fetchReadingPromptContext(reader, source, new AbortController().signal),
    ).rejects.toThrow("request budget");
    expect(reader).toHaveBeenCalledTimes(8);
  });

  it.each([
    { epoch: "wrong" },
    { reset: true },
    { staleCursor: true },
    { gap: true },
    { error: "failed" },
    { entries: [entry(220, 242)] },
    { entries: [entry(246, 256), entry(246, 256)] },
    { entries: [{ ...entry(246, 256), sourceSeqRanges: [] }] },
  ])("rejects changed, missing or ambiguous source metadata %j", async (invalid) => {
    const reader = vi.fn().mockResolvedValue({ ...page([entry(246, 256)]), ...invalid });
    await expect(
      fetchReadingPromptContext(reader, source, new AbortController().signal),
    ).rejects.toThrow();
    expect(reader).toHaveBeenCalledTimes(1);
  });

  it("exhausts tool-only history without applying pages", async () => {
    const reader = vi
      .fn()
      .mockResolvedValueOnce(page([entry(246, 256)]))
      .mockResolvedValueOnce(page([], false));
    expect(
      await fetchReadingPromptContext(reader, source, new AbortController().signal),
    ).toBeUndefined();
    expect(reader).toHaveBeenCalledTimes(2);
  });

  it("rejects nonprogress instead of looping", async () => {
    const reader = vi
      .fn()
      .mockResolvedValueOnce(page([entry(246, 256)]))
      .mockResolvedValueOnce(page([entry(246, 256)]));
    await expect(
      fetchReadingPromptContext(reader, source, new AbortController().signal),
    ).rejects.toThrow("backward");
    expect(reader).toHaveBeenCalledTimes(2);
  });

  it("cancels a held probe before any backward request", async () => {
    const held = deferred<ContextPage>();
    const reader = vi.fn(() => held.promise);
    const controller = new AbortController();
    const result = fetchReadingPromptContext(reader, source, controller.signal);
    controller.abort();
    held.resolve(page([entry(246, 256)]));
    await expect(result).rejects.toThrow();
    expect(reader).toHaveBeenCalledTimes(1);
  });

  it("walks tool-only pages to the nearest USER and cancels held backward work", async () => {
    const tool: ContextEntry = {
      ...entry(218, 218),
      item: {
        type: "tool_call",
        callId: "call",
        name: "Read",
        status: "completed",
        error: null,
        detail: { type: "read", filePath: "file" },
      },
    };
    const held = deferred<ContextPage>();
    const reader = vi
      .fn()
      .mockResolvedValueOnce(page([entry(246, 256)]))
      .mockResolvedValueOnce(page([tool]))
      .mockImplementationOnce(() => held.promise);
    const controller = new AbortController();
    const result = fetchReadingPromptContext(reader, source, controller.signal);
    await waitFor(() => expect(reader).toHaveBeenCalledTimes(3));
    expect(reader.mock.calls[2]![0].cursor).toBe(218);
    controller.abort();
    held.resolve(page([entry(63, 63, "user_message")]));
    await expect(result).rejects.toThrow("cancelled");
    expect(reader).toHaveBeenCalledTimes(3);
  });

  it("retries a context failure and caches exhausted history without repeated reads", async () => {
    const fetchContext = vi
      .fn()
      .mockRejectedValueOnce(new Error("missing source"))
      .mockResolvedValue(undefined);
    const { result, rerender } = renderHook(useReadingPrompt, {
      initialProps: { epoch: "epoch", seq: undefined, knownPrompts: [], source, fetchContext },
    });
    await waitFor(() => expect(result.current.error).toBe(true));
    act(() => result.current.retry());
    await waitFor(() => expect(fetchContext).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender({
      epoch: "epoch",
      seq: undefined,
      knownPrompts: [],
      source: { ...source },
      fetchContext,
    });
    expect(result.current.error).toBe(false);
    expect(fetchContext).toHaveBeenCalledTimes(2);
  });

  it("shares the sixteen-entry cap between context and known canonical prompts", async () => {
    const fetchContext = vi.fn(async () => stickyUser("context", 1, "epoch"));
    const knownPrompts = Array.from({ length: 16 }, (_, i) =>
      stickyUser(`known-${i}`, i + 300, "epoch"),
    );
    const { result, rerender } = renderHook(useReadingPrompt, {
      initialProps: {
        epoch: "epoch",
        seq: undefined,
        knownPrompts: [] as UserPrompt[],
        source,
        fetchContext,
      },
    });
    await waitFor(() => expect(result.current.item?.id).toBe("context"));
    rerender({
      epoch: "epoch",
      seq: undefined,
      knownPrompts,
      source: { ...source, id: "other" },
      fetchContext,
    });
    await waitFor(() => expect(fetchContext).toHaveBeenCalledTimes(2));
    rerender({ epoch: "epoch", seq: undefined, knownPrompts, source, fetchContext });
    await waitFor(() => expect(fetchContext).toHaveBeenCalledTimes(3));
  });

  it("scopes child reads to the exact owner and never applies their payload", async () => {
    const fetchProviderSubagentTimeline = vi.fn().mockResolvedValue({
      ...page([entry(246, 256)]),
      parentAgentId: "parent",
      subagentId: "child",
      provider: "mock",
      direction: "before",
      rows: [{ ...entry(246, 256), seq: 256 }],
    });
    const client = { fetchProviderSubagentTimeline } as unknown as DaemonClient;
    const reader = childContextPageReader(client, "parent", "child");
    const request = { epoch: "epoch", cursor: 257, limit: 1, projection: "projected" as const };
    expect((await reader(request)).entries[0]?.seqStart).toBe(246);
    expect(fetchProviderSubagentTimeline).toHaveBeenCalledExactlyOnceWith("parent", "child", {
      direction: "before",
      cursor: { epoch: "epoch", seq: 257 },
      limit: 1,
    });
    fetchProviderSubagentTimeline.mockResolvedValue({
      parentAgentId: "other",
      subagentId: "child",
    });
    await expect(reader(request)).rejects.toThrow("child identity");
  });

  it("does not publish a held context after epoch replacement", async () => {
    const held = deferred<UserPrompt | undefined>();
    const fetchContext = vi.fn((_source: StreamItem, _signal: AbortSignal) => held.promise);
    const { result, rerender } = renderHook(useReadingPrompt, {
      initialProps: { epoch: "epoch", seq: undefined, knownPrompts: [], source, fetchContext },
    });
    await waitFor(() => expect(fetchContext).toHaveBeenCalledTimes(1));
    rerender({
      epoch: "new",
      seq: undefined,
      knownPrompts: [],
      source: { ...source, timelineCursor: { epoch: "new", seq: 256 } },
      fetchContext,
    });
    expect(fetchContext.mock.calls[0]![1].aborted).toBe(true);
    await act(async () => held.resolve(stickyUser("old", 1, "epoch")));
    expect(result.current.item?.timelineCursor?.epoch).not.toBe("epoch");
  });
});

describe("strict old-host context accounting", () => {
  const sourceResponse = () => ({
    ...contentReadResponse("assistant_message"),
    direction: "tail",
    hasOlder: true,
    entries: [
      {
        ...contentReadResponse("assistant_message").entries[0]!,
        seqStart: 246,
        seqEnd: 256,
        sourceSeqRanges: [{ startSeq: 246, endSeq: 256 }],
      },
    ],
  });
  const probeRequest = () => ({
    ...contentReadRequest("probe"),
    cursor: { epoch: "epoch", seq: 257 },
  });
  const probeResponse = () => ({
    ...sourceResponse(),
    direction: "before",
    requestId: "probe",
    startCursor: { epoch: "epoch", seq: 256 },
    endCursor: { epoch: "epoch", seq: 256 },
  });
  const contextRequest = () => ({
    ...contentReadRequest("context-page"),
    limit: 40,
    projection: "canonical",
    cursor: { epoch: "epoch", seq: 246 },
  });
  const oldLedger = () => {
    const ledger = createTimelineRequestLedger("agent", protocolSchemas);
    ledger.observeWindow(sourceResponse());
    return ledger;
  };
  it("accounts for source probe and canonical content separately from the unchanged window budget", () => {
    const ledger = oldLedger();
    expect(ledger.classify({ ...contentReadRequest("window"), limit: 40 })).toBe("window");
    expect(ledger.classify(probeRequest())).toBe("context");
    ledger.completeContext(probeResponse());
    expect(ledger.classify(contextRequest())).toBe("context");
    ledger.completeContext({
      ...contentReadResponse(),
      requestId: "context-page",
      projection: "canonical",
    });
    expect(ledger.summary()).toMatchObject({
      allBefore: 3,
      windowBefore: 1,
      contentBefore: 0,
      contextBefore: 2,
      pendingContext: 0,
      contextChainActive: false,
      errors: [],
    });
  });
  it.each([
    { agentId: "other" },
    { limit: 2 },
    { mergeWindow: true },
    { cursor: { epoch: "other", seq: 257 } },
    { cursor: { epoch: "epoch", seq: 256 } },
  ])("rejects unowned probe %j", (invalid) => {
    const ledger = oldLedger();
    expect(ledger.classify({ ...probeRequest(), ...invalid })).toBeUndefined();
    expect(ledger.summary().errors).toHaveLength(1);
  });
  it.each([
    { epoch: "other" },
    { agentId: "other" },
    { entries: [{}] },
    { reset: true },
    { endCursor: { epoch: "epoch", seq: 255 } },
    { entries: [{ ...sourceResponse().entries[0]!, sourceSeqRanges: [] }] },
    { entries: [{ ...sourceResponse().entries[0]!, seqEnd: 255 }] },
  ])("records malformed or changed probe response %j without throwing", (invalid) => {
    const ledger = oldLedger();
    ledger.classify(probeRequest());
    expect(() => ledger.completeContext({ ...probeResponse(), ...invalid })).not.toThrow();
    expect(ledger.summary().errors).toHaveLength(1);
  });
  it("rejects duplicate probe, response and wrong backward cursor", () => {
    const ledger = oldLedger();
    ledger.classify(probeRequest());
    ledger.completeContext(probeResponse());
    expect(ledger.classify({ ...probeRequest(), requestId: "duplicate" })).toBeUndefined();
    ledger.completeContext(probeResponse());
    expect(
      ledger.classify({ ...contextRequest(), cursor: { epoch: "epoch", seq: 247 } }),
    ).toBeUndefined();
    expect(ledger.summary().errors).toHaveLength(3);
  });
  it("rejects a ninth request rather than assigning it a window slot", () => {
    const ledger = oldLedger();
    ledger.classify(probeRequest());
    ledger.completeContext(probeResponse());
    for (let n = 1; n < 8; n += 1) {
      const cursor = 247 - n;
      const id = `page-${n}`;
      expect(
        ledger.classify({
          ...contextRequest(),
          requestId: id,
          cursor: { epoch: "epoch", seq: cursor },
        }),
      ).toBe("context");
      const seq = cursor - 1;
      ledger.completeContext({
        ...sourceResponse(),
        direction: "before",
        projection: "canonical",
        requestId: id,
        startCursor: { epoch: "epoch", seq },
        endCursor: { epoch: "epoch", seq },
        entries: [
          {
            ...sourceResponse().entries[0]!,
            seqStart: seq,
            seqEnd: seq,
            sourceSeqRanges: [{ startSeq: seq, endSeq: seq }],
          },
        ],
      });
    }
    expect(
      ledger.classify({
        ...contextRequest(),
        requestId: "ninth",
        cursor: { epoch: "epoch", seq: 239 },
      }),
    ).toBeUndefined();
    expect(ledger.summary()).toMatchObject({ contextBefore: 8, windowBefore: 0 });
    expect(ledger.summary().errors).toHaveLength(1);
  });
});

/** Unit input exercises visibility ownership, without pretending that a dispatched event proves browser hover. */
function sendNavigationPointer(type: "pointerdown" | "pointermove", x: number, y: number) {
  const event = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true });
  Object.defineProperty(event, "pointerType", { value: "mouse" });
  document.dispatchEvent(event);
}

describe("arrow destination action visibility", () => {
  it("keeps held destination actions through the next pointerdown until the next arrow activates", () => {
    const { result } = renderHook(() => useNavigationActionVisibility(true, "epoch-a"));
    act(() => {
      sendNavigationPointer("pointerdown", 1222, 164);
      result.current.start("middle");
    });
    expect(result.current.key).toBe("middle");
    // Discrete pointerdown flushes before pointerup/click. Hiding here disables the
    // same button that must receive the second click, before it can replace ownership.
    act(() => sendNavigationPointer("pointerdown", 1222, 164));
    expect(result.current.key).toBe("middle");
    act(() => result.current.start("oldest"));
    expect(result.current.key).toBe("oldest");
  });

  it("holds the actual arrow destination through the navigation context, but not content reveal or cancel", () => {
    const input = stickyInput([stickyUser("one", 1), stickyUser("two", 2), stickyUser("three", 3)]);
    const { result } = renderHook(() => {
      const navigation = useStickyPrompt(input);
      return { navigation, controls: usePromptNavigationControls(navigation) };
    });
    act(() => result.current.navigation.activate("three", -1));
    expect(result.current.controls.actionVisibleMessageId).toBe("two");
    expect(input.jumpToLoaded).toHaveBeenLastCalledWith("two", "pinned");
    act(() => result.current.navigation.next());
    expect(result.current.controls.actionVisibleMessageId).toBe("three");
    act(() => result.current.navigation.reveal());
    expect(result.current.controls.actionVisibleMessageId).toBeUndefined();
    act(() => result.current.navigation.previous());
    expect(result.current.controls.actionVisibleMessageId).toBe("two");
    act(() => result.current.navigation.cancel());
    expect(result.current.controls.actionVisibleMessageId).toBeUndefined();
  });

  it("keeps stationary layout events visible, then clears on actual mouse coordinate change", () => {
    const { result } = renderHook(() => useNavigationActionVisibility(true, "epoch-a"));
    act(() => {
      sendNavigationPointer("pointerdown", 1222, 545);
      result.current.start("destination");
    });
    expect(result.current.key).toBe("destination");
    act(() => sendNavigationPointer("pointermove", 1222, 545));
    expect(result.current.key).toBe("destination");
    act(() => sendNavigationPointer("pointermove", 1223, 545));
    expect(result.current.key).toBeNull();
    act(() => result.current.retarget("late-discovery"));
    expect(result.current.key).toBeNull();
  });

  it("replaces the destination, cancels on scroll or explicit cancellation, and isolates epochs and opt-out", () => {
    const { result, rerender } = renderHook(
      ({ enabled, epoch }) => useNavigationActionVisibility(enabled, epoch),
      { initialProps: { enabled: true, epoch: "epoch-a" } },
    );
    act(() => result.current.start("first"));
    act(() => result.current.start("second"));
    expect(result.current.key).toBe("second");
    act(() => document.dispatchEvent(new Event("wheel")));
    expect(result.current.key).toBeNull();
    act(() => result.current.start("third"));
    act(() => result.current.clear());
    expect(result.current.key).toBeNull();
    act(() => result.current.start("old-epoch"));
    rerender({ enabled: true, epoch: "epoch-b" });
    expect(result.current.key).toBeNull();
    act(() => result.current.start("new-epoch"));
    rerender({ enabled: false, epoch: "epoch-b" });
    expect(result.current.key).toBeNull();
    act(() => result.current.start("disabled"));
    expect(result.current.key).toBeNull();
  });

  it("retargets held discovery without reviving a cleared request and removes listeners on unmount", () => {
    const remove = vi.spyOn(document, "removeEventListener");
    const { result, unmount } = renderHook(() => useNavigationActionVisibility(true, null));
    act(() => result.current.start("discover-previous"));
    act(() => result.current.retarget("canonical-target"));
    expect(result.current.key).toBe("canonical-target");
    unmount();
    expect(remove).toHaveBeenCalledWith("pointermove", expect.any(Function), true);
    expect(remove).toHaveBeenCalledWith("wheel", expect.any(Function), true);
    remove.mockRestore();
  });
});
