import type { StreamItem } from "@/types/stream";
import { createNativePromptJumpController } from "./native-prompt-jump";
import { describe, expect, it, vi } from "vitest";
import {
  createPromptJumpSettleController,
  type PromptJumpSettleViewport,
} from "./prompt-jump-settle";

interface FakeFrameScheduler {
  requestFrame(callback: () => void): number;
  cancelFrame(frameId: number): void;
  runNextFrame(): void;
  pendingFrames(): number;
}

interface FakeViewport extends PromptJumpSettleViewport {
  emitUserIntent(): void;
  setTargetTop(itemId: string, top: number | null): void;
  scrollWrites(): number[];
  requestedTargets(): string[];
}

function createFakeFrameScheduler(): FakeFrameScheduler {
  const frames = new Map<number, () => void>();
  let nextFrameId = 1;
  return {
    requestFrame(callback) {
      const frameId = nextFrameId;
      nextFrameId += 1;
      frames.set(frameId, callback);
      return frameId;
    },
    cancelFrame(frameId) {
      frames.delete(frameId);
    },
    runNextFrame() {
      const next = frames.entries().next().value;
      if (!next) {
        throw new Error("Expected a pending prompt jump frame");
      }
      const [frameId, callback] = next;
      frames.delete(frameId);
      callback();
    },
    pendingFrames() {
      return frames.size;
    },
  };
}

function createFakeViewport(input?: {
  clientHeight?: number;
  scrollHeight?: number;
  scrollTop?: number;
}): FakeViewport {
  const targets = new Map<string, number>();
  const requestedTargets: string[] = [];
  const scrollWrites: number[] = [];
  const userIntentListeners = new Set<() => void>();
  const clientHeight = input?.clientHeight ?? 100;
  const scrollHeight = input?.scrollHeight ?? 1_000;
  let scrollTop = input?.scrollTop ?? 100;
  return {
    findTargetTop(itemId) {
      requestedTargets.push(itemId);
      return targets.get(itemId) ?? null;
    },
    getContainerTop() {
      return 0;
    },
    getScrollMetrics() {
      return { clientHeight, scrollHeight, scrollTop };
    },
    setScrollTop(nextScrollTop) {
      const previousScrollTop = scrollTop;
      const maxScrollTop = scrollHeight - clientHeight;
      scrollTop = Math.max(0, Math.min(nextScrollTop, maxScrollTop));
      const appliedDelta = scrollTop - previousScrollTop;
      for (const [itemId, top] of targets) {
        targets.set(itemId, top - appliedDelta);
      }
      scrollWrites.push(scrollTop);
    },
    subscribeToUserIntent(listener) {
      userIntentListeners.add(listener);
      return () => userIntentListeners.delete(listener);
    },
    emitUserIntent() {
      for (const listener of userIntentListeners) listener();
    },
    setTargetTop(itemId, top) {
      if (top === null) {
        targets.delete(itemId);
      } else {
        targets.set(itemId, top);
      }
    },
    scrollWrites() {
      return scrollWrites;
    },
    requestedTargets() {
      return requestedTargets;
    },
  };
}

function createController(viewport: FakeViewport, frames: FakeFrameScheduler) {
  return createPromptJumpSettleController({
    viewport,
    requestFrame: frames.requestFrame,
    cancelFrame: frames.cancelFrame,
  });
}

describe("prompt jump settle", () => {
  it("re-pins the target when geometry shifts between frames", () => {
    const frames = createFakeFrameScheduler();
    const viewport = createFakeViewport();
    const controller = createController(viewport, frames);
    viewport.setTargetTop("target", 48);

    controller.start("target");
    frames.runNextFrame();
    viewport.setTargetTop("target", 28);
    frames.runNextFrame();

    expect(viewport.scrollWrites()).toEqual([140, 160]);
  });

  it("succeeds after two consecutive in-position frames", () => {
    const frames = createFakeFrameScheduler();
    const viewport = createFakeViewport();
    const controller = createController(viewport, frames);
    viewport.setTargetTop("target", 8);

    controller.start("target");
    frames.runNextFrame();
    frames.runNextFrame();

    expect(controller.isActive()).toBe(false);
  });

  it("succeeds when the target remains below the top at maximum scroll", () => {
    const frames = createFakeFrameScheduler();
    const viewport = createFakeViewport({ clientHeight: 100, scrollHeight: 220, scrollTop: 100 });
    const controller = createController(viewport, frames);
    viewport.setTargetTop("target", 50);

    controller.start("target");
    frames.runNextFrame();

    expect({ active: controller.isActive(), writes: viewport.scrollWrites() }).toEqual({
      active: false,
      writes: [120],
    });
  });

  it("aborts on user intent", () => {
    const frames = createFakeFrameScheduler();
    const viewport = createFakeViewport();
    const controller = createController(viewport, frames);

    controller.start("target");
    viewport.emitUserIntent();

    expect({ active: controller.isActive(), frames: frames.pendingFrames() }).toEqual({
      active: false,
      frames: 0,
    });
  });

  it("expires after its frame budget", () => {
    const frames = createFakeFrameScheduler();
    const viewport = createFakeViewport();
    const controller = createController(viewport, frames);

    controller.start("missing");
    for (let frame = 0; frame < 24; frame += 1) frames.runNextFrame();

    expect(controller.isActive()).toBe(false);
  });

  it("cancels the previous target when a newer jump starts", () => {
    const frames = createFakeFrameScheduler();
    const viewport = createFakeViewport();
    const controller = createController(viewport, frames);
    viewport.setTargetTop("new", 8);

    controller.start("old");
    controller.start("new");
    frames.runNextFrame();

    expect(viewport.requestedTargets()).toEqual(["new"]);
  });
});

/** FlatList synchronously reports unmeasured indices; retry callbacks can survive cancellation. */
function nativeJumpFixture() {
  let header: number | null = 6000;
  let index = 12;
  let liveOffset: number | undefined;
  let measured = 0;
  let clock = 0;
  let failIndex = true;
  const callbacks = new Set<() => void>();
  const archivedCallbacks: Array<() => void> = [];
  const onFailure = vi.fn();
  const scrollToOffset = vi.fn();
  const scrollToIndex = vi.fn((target: number) => {
    if (failIndex)
      controller.handleIndexFailure({
        index: target,
        averageItemLength: 100,
        highestMeasuredFrameIndex: measured,
      });
  });
  const controller = createNativePromptJumpController({
    viewport: {
      findHistoryIndex: () => index,
      findLiveOffset: () => liveOffset,
      getLiveHeaderHeight: () => header,
      scrollToIndex,
      scrollToOffset,
    },
    scheduleRetry(callback) {
      callbacks.add(callback);
      archivedCallbacks.push(callback);
      return () => {
        callbacks.delete(callback);
      };
    },
    now: () => clock,
    onFailure,
  });
  return {
    controller,
    scrollToOffset,
    scrollToIndex,
    onFailure,
    archivedCallbacks,
    pending: () => callbacks.size,
    retry() {
      const next = callbacks.values().next().value;
      expect(next).toBeDefined();
      callbacks.delete(next!);
      next!();
    },
    setHeader(value: number | null) {
      header = value;
    },
    setLiveOffset(value: number) {
      liveOffset = value;
    },
    setIndex(value: number) {
      index = value;
    },
    setMeasured(value: number) {
      measured = value;
    },
    setClock(value: number) {
      clock = value;
    },
    succeed() {
      failIndex = false;
    },
  };
}

describe("native prompt viewport recovery", () => {
  it("includes long measured live header, rebases stable ID, then lands exactly", () => {
    const f = nativeJumpFixture();
    f.controller.start("prompt");
    expect(f.scrollToOffset).toHaveBeenLastCalledWith(7200, false);
    f.setIndex(14);
    f.succeed();
    f.retry();
    expect(f.scrollToIndex).toHaveBeenLastCalledWith(14);
    expect(f.controller.isActive()).toBe(false);
    expect(f.onFailure).not.toHaveBeenCalled();
  });
  it("waits for an unmeasured header rather than treating it as zero", () => {
    const f = nativeJumpFixture();
    f.setHeader(null);
    f.controller.start("prompt");
    expect(f.scrollToOffset).not.toHaveBeenCalled();
    f.setHeader(9000);
    f.retry();
    expect(f.scrollToOffset).toHaveBeenLastCalledWith(10200, false);
  });
  it("stops repeated no-progress retries and reports the same target", () => {
    const f = nativeJumpFixture();
    f.controller.start("prompt");
    for (let i = 0; i < 3; i++) f.retry();
    expect(f.onFailure).toHaveBeenCalledWith("prompt");
    expect(f.scrollToIndex).toHaveBeenCalledTimes(4);
    expect(f.pending()).toBe(0);
  });
  it("does not reset attempt budget when measurements keep changing", () => {
    const f = nativeJumpFixture();
    f.controller.start("prompt");
    for (let i = 1; i < 8; i++) {
      f.setMeasured(i);
      f.retry();
    }
    expect(f.scrollToIndex).toHaveBeenCalledTimes(8);
    expect(f.pending()).toBe(0);
    expect(f.onFailure).toHaveBeenCalledTimes(1);
  });
  it("cancels stale callbacks on bottom, another jump or lifecycle cleanup", () => {
    const f = nativeJumpFixture();
    f.controller.start("first");
    const stale = f.archivedCallbacks[0]!;
    f.controller.cancel();
    stale();
    expect(f.scrollToIndex).toHaveBeenCalledTimes(1);
    f.controller.start("second");
    stale();
    expect(f.scrollToIndex).toHaveBeenCalledTimes(2);
    f.controller.cancel();
    f.archivedCallbacks.at(-1)!();
    expect(f.pending()).toBe(0);
    expect(f.onFailure).not.toHaveBeenCalled();
  });
  it("bounds wall time and reports a missing stable target", () => {
    const f = nativeJumpFixture();
    f.controller.start("prompt");
    f.setClock(2000);
    f.retry();
    expect(f.onFailure).toHaveBeenCalledTimes(1);
    f.setIndex(-1);
    f.controller.start("missing");
    expect(f.onFailure).toHaveBeenLastCalledWith("missing");
    expect(f.pending()).toBe(0);
  });
});

it("smooth prompt scrolling produces intermediate positions and settles the measured target", () => {
  const frames = createFakeFrameScheduler();
  const viewport = createFakeViewport({ scrollHeight: 3000 });
  viewport.setTargetTop("prompt", 1000);
  let now = 0;
  const finished = vi.fn();
  const controller = createPromptJumpSettleController({
    viewport,
    requestFrame: frames.requestFrame,
    cancelFrame: frames.cancelFrame,
    now: () => now,
    onFinished: finished,
  });
  controller.start("prompt", { smooth: true });
  now = 60;
  frames.runNextFrame();
  const first = viewport.scrollWrites()[0]!;
  expect(first).toBeGreaterThan(100);
  expect(first).toBeLessThan(1092);
  now = 120;
  frames.runNextFrame();
  expect(viewport.scrollWrites()[1]).toBeGreaterThan(first);
  now = 240;
  frames.runNextFrame();
  while (frames.pendingFrames()) frames.runNextFrame();
  expect(viewport.findTargetTop("prompt")).toBeCloseTo(8);
  expect(finished).toHaveBeenCalledTimes(1);
});

it("manual intent cancels smooth scrolling without a stale frame moving the viewport", () => {
  const frames = createFakeFrameScheduler();
  const viewport = createFakeViewport();
  viewport.setTargetTop("prompt", 700);
  const controller = createPromptJumpSettleController({
    viewport,
    requestFrame: frames.requestFrame,
    cancelFrame: frames.cancelFrame,
    now: () => 0,
  });
  controller.start("prompt", { smooth: true });
  viewport.emitUserIntent();
  expect(frames.pendingFrames()).toBe(0);
  expect(viewport.scrollWrites()).toEqual([]);
});

import {
  resolveNativeReadingPosition,
  resolveNativeLivePromptOffset,
} from "./native-reading-position";

it("native viewability selects the chronological reading edge and records visible original bubbles", () => {
  const user = {
    id: "history-user",
    kind: "user_message",
    text: "prompt",
    timestamp: new Date(0),
  } as StreamItem;
  const answer = { ...user, id: "answer", kind: "assistant_message" } as StreamItem;
  const position = resolveNativeReadingPosition({
    visibleHistory: [
      { item: answer, index: 2, isViewable: true },
      { item: user, index: 3, isViewable: true },
    ],
    liveHead: [],
    liveGeometry: new Map(),
    headerHeight: 100,
    viewportHeight: 600,
    offsetY: 400,
  });
  expect(position).toEqual({ rowId: "history-user", visibleUserIds: ["history-user"] });
});

it("native measured live header tracks the original leaving view without DOM APIs", () => {
  const user = {
    id: "live-user",
    kind: "user_message",
    text: "prompt",
    timestamp: new Date(0),
  } as StreamItem;
  const answer = { ...user, id: "live-answer", kind: "assistant_message" } as StreamItem;
  const input = {
    visibleHistory: [],
    liveHead: [user, answer],
    headerHeight: 6000,
    liveGeometry: new Map([
      [user.id, { y: 0, height: 100 }],
      [answer.id, { y: 100, height: 5900 }],
    ]),
    viewportHeight: 600,
  };
  expect(resolveNativeReadingPosition({ ...input, offsetY: 5350 })).toEqual({
    rowId: user.id,
    visibleUserIds: [user.id],
  });
  expect(resolveNativeReadingPosition({ ...input, offsetY: 5300 })).toEqual({
    rowId: answer.id,
    visibleUserIds: [],
  });
  expect(resolveNativeLivePromptOffset(6000, 600, 100)).toBe(5300);
  expect(resolveNativeLivePromptOffset(300, 600, 100)).toBe(0);
});

it("native live prompt uses its measured landing offset and the animated path", () => {
  const f = nativeJumpFixture();
  f.setIndex(-1);
  f.setLiveOffset(5300);
  f.controller.start("live-prompt");
  expect(f.scrollToOffset).toHaveBeenCalledWith(5300, true);
  expect(f.scrollToIndex).not.toHaveBeenCalled();
  expect(f.onFailure).not.toHaveBeenCalled();
  expect(f.controller.isActive()).toBe(false);
});
