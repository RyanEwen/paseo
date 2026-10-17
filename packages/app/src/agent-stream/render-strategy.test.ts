import { beginDrag, releaseDrag } from "./scroll-keyboard-dismiss/model";
import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import {
  collectAssistantResponseContentForStreamRenderStrategy,
  getBottomOffsetForStreamRenderStrategy,
  getFrameChildOrderForStreamRenderStrategy,
  getHistoryLiveBoundaryIndexForStreamRenderStrategy,
  getLiveHeadHistoryBoundaryIndexForStreamRenderStrategy,
  getStreamEdgeSlotProps,
  getStreamNeighborIndex,
  getStreamNeighborItem,
  isNearBottomForStreamRenderStrategy,
  orderHeadForStreamRenderStrategy,
  orderTailForStreamRenderStrategy,
  resolveBottomAnchorTransportBehavior,
} from "./strategy";
import { resolveStreamRenderStrategy } from "./strategy-resolver";

function createTimestamp(seed: number): Date {
  return new Date(`2026-01-01T00:00:0${seed}.000Z`);
}

function userMessage(id: string, text: string, seed: number): StreamItem {
  return {
    kind: "user_message",
    id,
    text,
    timestamp: createTimestamp(seed),
  };
}

function assistantMessage(id: string, text: string, seed: number): StreamItem {
  return {
    kind: "assistant_message",
    id,
    text,
    timestamp: createTimestamp(seed),
  };
}

function toolCall(id: string, seed: number): StreamItem {
  return {
    kind: "tool_call",
    id,
    timestamp: createTimestamp(seed),
    payload: {
      source: "orchestrator",
      data: {
        toolCallId: id,
        toolName: "Shell",
        arguments: "echo hi",
        result: null,
        status: "completed",
      },
    },
  };
}

describe("resolveStreamRenderStrategy", () => {
  it("uses forward_stream on web", () => {
    const strategy = resolveStreamRenderStrategy({
      platform: "web",
      isMobileBreakpoint: false,
    });

    expect(strategy.shouldUseVirtualizedList()).toBe(false);
    expect(strategy.getFlatListInverted()).toBe(false);
    expect(strategy.getOverlayScrollbarInverted()).toBe(false);
    expect(strategy.shouldAnchorBottomOnContentSizeChange()).toBe(true);
    expect(strategy.getBottomAnchorTransportBehavior()).toEqual({
      verificationDelayFrames: 0,
      verificationRetryMode: "rescroll",
    });
  });

  it("uses chronological_native_stream on native", () => {
    const strategy = resolveStreamRenderStrategy({
      platform: "ios",
      isMobileBreakpoint: false,
    });

    expect(strategy.shouldUseVirtualizedList()).toBe(true);
    expect(strategy.getFlatListInverted()).toBe(false);
    expect(strategy.getOverlayScrollbarInverted()).toBe(false);
    expect(strategy.shouldAnchorBottomOnContentSizeChange()).toBe(false);
    expect(strategy.getBottomAnchorTransportBehavior()).toEqual({
      verificationDelayFrames: 2,
      verificationRetryMode: "recheck",
    });
  });

  it("delays native verification while viewport settling is in flight", () => {
    const strategy = resolveStreamRenderStrategy({
      platform: "ios",
      isMobileBreakpoint: false,
    });

    expect(
      resolveBottomAnchorTransportBehavior({
        strategy,
        isViewportSettling: true,
      }),
    ).toEqual({
      verificationDelayFrames: 4,
      verificationRetryMode: "recheck",
    });
  });

  it("does not inflate forward-stream verification delays during web resize", () => {
    const strategy = resolveStreamRenderStrategy({
      platform: "web",
      isMobileBreakpoint: false,
    });

    expect(
      resolveBottomAnchorTransportBehavior({
        strategy,
        isViewportSettling: true,
      }),
    ).toEqual({
      verificationDelayFrames: 0,
      verificationRetryMode: "rescroll",
    });
  });
});

describe("stream ordering", () => {
  const streamItems: StreamItem[] = [
    userMessage("u1", "user-1", 1),
    assistantMessage("a1", "assistant-1", 2),
    assistantMessage("a2", "assistant-2", 3),
  ];

  it("keeps forward_stream order unchanged for tail and head", () => {
    const strategy = resolveStreamRenderStrategy({
      platform: "web",
      isMobileBreakpoint: false,
    });

    const tail = orderTailForStreamRenderStrategy({ strategy, streamItems });
    const head = orderHeadForStreamRenderStrategy({ strategy, streamHead: streamItems });

    expect(tail.map((item) => item.id)).toEqual(["u1", "a1", "a2"]);
    expect(head.map((item) => item.id)).toEqual(["u1", "a1", "a2"]);
  });

  it("preserves chronological_native_stream order for tail and head", () => {
    const strategy = resolveStreamRenderStrategy({
      platform: "android",
      isMobileBreakpoint: false,
    });

    const tail = orderTailForStreamRenderStrategy({ strategy, streamItems });
    const head = orderHeadForStreamRenderStrategy({ strategy, streamHead: streamItems });

    expect(tail.map((item) => item.id)).toEqual(["u1", "a1", "a2"]);
    expect(head.map((item) => item.id)).toEqual(["u1", "a1", "a2"]);
  });
});

describe("neighbor and traversal semantics", () => {
  it("maps above/below indices for web and chronological native streams", () => {
    const forward = resolveStreamRenderStrategy({
      platform: "web",
      isMobileBreakpoint: false,
    });
    const native = resolveStreamRenderStrategy({
      platform: "ios",
      isMobileBreakpoint: false,
    });

    expect(getStreamNeighborIndex({ strategy: forward, index: 3, relation: "above" })).toBe(2);
    expect(getStreamNeighborIndex({ strategy: forward, index: 3, relation: "below" })).toBe(4);
    expect(getStreamNeighborIndex({ strategy: native, index: 3, relation: "above" })).toBe(2);
    expect(getStreamNeighborIndex({ strategy: native, index: 3, relation: "below" })).toBe(4);
  });

  it("collects assistant response content with strategy traversal direction", () => {
    const chronological: StreamItem[] = [
      userMessage("u1", "user-1", 1),
      assistantMessage("a1", "assistant-1", 2),
      assistantMessage("a2", "assistant-2", 3),
      userMessage("u2", "user-2", 4),
    ];

    const forward = resolveStreamRenderStrategy({
      platform: "web",
      isMobileBreakpoint: false,
    });
    const forwardStartIndex = chronological.findIndex((item) => item.id === "a2");
    expect(
      collectAssistantResponseContentForStreamRenderStrategy({
        strategy: forward,
        items: chronological,
        startIndex: forwardStartIndex,
      }),
    ).toBe("assistant-1\n\nassistant-2");

    const native = resolveStreamRenderStrategy({
      platform: "android",
      isMobileBreakpoint: false,
    });
    const nativeItems = orderTailForStreamRenderStrategy({
      strategy: native,
      streamItems: chronological,
    });
    const nativeStartIndex = nativeItems.findIndex((item) => item.id === "a2");
    expect(
      collectAssistantResponseContentForStreamRenderStrategy({
        strategy: native,
        items: nativeItems,
        startIndex: nativeStartIndex,
      }),
    ).toBe("assistant-1\n\nassistant-2");
  });

  it("collects copy content across adjacent turns without a visible prompt", () => {
    const chronological: StreamItem[] = [
      { ...assistantMessage("a1", "first turn", 1), turnId: "turn-1" },
      { ...toolCall("tool", 2), turnId: "turn-2" },
      { ...assistantMessage("a2", "second turn", 3), turnId: "turn-2" },
    ];
    const strategy = resolveStreamRenderStrategy({ platform: "web", isMobileBreakpoint: false });

    expect(
      collectAssistantResponseContentForStreamRenderStrategy({
        strategy,
        items: chronological,
        startIndex: 2,
      }),
    ).toBe("first turn\n\nsecond turn");
  });

  it("returns undefined neighbor when index would be out of bounds", () => {
    const forward = resolveStreamRenderStrategy({
      platform: "web",
      isMobileBreakpoint: false,
    });
    const items: StreamItem[] = [userMessage("u1", "user-1", 1)];

    expect(
      getStreamNeighborItem({
        strategy: forward,
        items,
        index: 0,
        relation: "above",
      }),
    ).toBeUndefined();
    expect(
      getStreamNeighborItem({
        strategy: forward,
        items,
        index: 0,
        relation: "below",
      }),
    ).toBeUndefined();
  });
});

describe("scroll/bottom calculations", () => {
  it("computes near-bottom using forward_stream distance-from-bottom math", () => {
    const strategy = resolveStreamRenderStrategy({
      platform: "web",
      isMobileBreakpoint: false,
    });

    expect(
      isNearBottomForStreamRenderStrategy({
        strategy,
        offsetY: 680,
        viewportHeight: 300,
        contentHeight: 1000,
        threshold: 24,
      }),
    ).toBe(true);
    expect(
      isNearBottomForStreamRenderStrategy({
        strategy,
        offsetY: 600,
        viewportHeight: 300,
        contentHeight: 1000,
        threshold: 24,
      }),
    ).toBe(false);
  });

  it("computes near-bottom and scroll-to-bottom offset for chronological_native_stream", () => {
    const strategy = resolveStreamRenderStrategy({
      platform: "ios",
      isMobileBreakpoint: false,
    });

    expect(
      isNearBottomForStreamRenderStrategy({
        strategy,
        offsetY: 688,
        viewportHeight: 300,
        contentHeight: 1000,
        threshold: 24,
      }),
    ).toBe(true);
    expect(
      isNearBottomForStreamRenderStrategy({
        strategy,
        offsetY: 660,
        viewportHeight: 300,
        contentHeight: 1000,
        threshold: 24,
      }),
    ).toBe(false);
    expect(
      getBottomOffsetForStreamRenderStrategy({
        strategy,
        viewportHeight: 300,
        contentHeight: 1000,
      }),
    ).toBe(700);
  });

  it("maps scroll-to-bottom to max offset for forward_stream", () => {
    const strategy = resolveStreamRenderStrategy({
      platform: "web",
      isMobileBreakpoint: false,
    });

    expect(
      getBottomOffsetForStreamRenderStrategy({
        strategy,
        viewportHeight: 320,
        contentHeight: 1000,
      }),
    ).toBe(680);
  });
});

describe("edge slot semantics", () => {
  it("uses footer slot for forward_stream and footer slot for chronological_native_stream", () => {
    const EdgeSlot = () => null;
    const forward = resolveStreamRenderStrategy({
      platform: "web",
      isMobileBreakpoint: false,
    });
    const native = resolveStreamRenderStrategy({
      platform: "android",
      isMobileBreakpoint: false,
    });

    const forwardProps = getStreamEdgeSlotProps({
      strategy: forward,
      component: EdgeSlot,
      gapSize: 4,
    });
    const nativeProps = getStreamEdgeSlotProps({
      strategy: native,
      component: EdgeSlot,
      gapSize: 4,
    });

    expect(forwardProps).toEqual({
      ListFooterComponent: EdgeSlot,
      ListFooterComponentStyle: { marginTop: 4 },
    });
    expect(nativeProps).toEqual({
      ListFooterComponent: EdgeSlot,
      ListFooterComponentStyle: { marginTop: 4 },
    });
  });
});

describe("layout strategy edges", () => {
  const streamItems: StreamItem[] = [
    userMessage("u1", "user-1", 1),
    assistantMessage("a1", "assistant-1", 2),
  ];

  it("uses the newest history edge as the history/live boundary", () => {
    const forward = resolveStreamRenderStrategy({
      platform: "web",
      isMobileBreakpoint: false,
    });
    const native = resolveStreamRenderStrategy({
      platform: "android",
      isMobileBreakpoint: false,
    });

    const forwardHistory = orderTailForStreamRenderStrategy({ strategy: forward, streamItems });
    const nativeHistory = orderTailForStreamRenderStrategy({ strategy: native, streamItems });

    expect(
      getHistoryLiveBoundaryIndexForStreamRenderStrategy({
        strategy: forward,
        history: forwardHistory,
      }),
    ).toBe(1);
    expect(
      getHistoryLiveBoundaryIndexForStreamRenderStrategy({
        strategy: native,
        history: nativeHistory,
      }),
    ).toBe(1);
  });

  it("uses the oldest live-head edge as the live-head/history boundary", () => {
    const forward = resolveStreamRenderStrategy({
      platform: "web",
      isMobileBreakpoint: false,
    });
    const native = resolveStreamRenderStrategy({
      platform: "ios",
      isMobileBreakpoint: false,
    });

    const forwardHead = orderHeadForStreamRenderStrategy({
      strategy: forward,
      streamHead: streamItems,
    });
    const nativeHead = orderHeadForStreamRenderStrategy({
      strategy: native,
      streamHead: streamItems,
    });

    expect(
      getLiveHeadHistoryBoundaryIndexForStreamRenderStrategy({
        strategy: forward,
        liveHead: forwardHead,
      }),
    ).toBe(0);
    expect(
      getLiveHeadHistoryBoundaryIndexForStreamRenderStrategy({
        strategy: native,
        liveHead: nativeHead,
      }),
    ).toBe(0);
  });

  it("names the frame child order needed by chronological native cells", () => {
    const forward = resolveStreamRenderStrategy({
      platform: "web",
      isMobileBreakpoint: false,
    });
    const native = resolveStreamRenderStrategy({
      platform: "android",
      isMobileBreakpoint: false,
    });

    expect(getFrameChildOrderForStreamRenderStrategy({ strategy: forward })).toBe(
      "content-then-footer",
    );
    expect(getFrameChildOrderForStreamRenderStrategy({ strategy: native })).toBe(
      "content-then-footer",
    );
  });
});

describe("native keyboard dismissal direction", () => {
  it("uses the chronological strategy direction for older-history flicks", () => {
    const strategy = resolveStreamRenderStrategy({ platform: "android", isMobileBreakpoint: true });
    const start = { timeStamp: 1000, nativeEvent: { contentOffset: { y: 500 }, timestamp: 1000 } };
    const release = {
      timeStamp: 1080,
      nativeEvent: { contentOffset: { y: 260 }, timestamp: 1080 },
    };
    expect(strategy.getFlatListInverted()).toBe(false);
    expect(
      releaseDrag(beginDrag(start), release, strategy.getFlatListInverted()).shouldDismiss,
    ).toBe(true);
  });
});
