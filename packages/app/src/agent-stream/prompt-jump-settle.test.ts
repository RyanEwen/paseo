import { resolvePromptHandoffProgress } from "./prompt-handoff";
import {
  createNativePromptHandoffPair,
  createNativePromptHandoffSampler,
  type NativePromptWindowRect,
} from "./native-prompt-handoff";
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
  estimateTargetTop(itemId: string): number | null;
  setEstimatedTargetTop(itemId: string, top: number): void;
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
  const estimates = new Map<string, number>();
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
    estimateTargetTop(itemId) {
      return estimates.get(itemId) ?? null;
    },
    setEstimatedTargetTop(itemId, top) {
      estimates.set(itemId, top);
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
      for (const [itemId, top] of estimates) estimates.set(itemId, top - appliedDelta);
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
  it("waits for a measured target when an unmounted estimate is already aligned", () => {
    const frames = createFakeFrameScheduler();
    const viewport = createFakeViewport();
    const controller = createController(viewport, frames);
    viewport.setEstimatedTargetTop("target", 8);

    controller.start("target");
    frames.runNextFrame();
    frames.runNextFrame();
    expect(controller.isActive()).toBe(true);

    // Mounting exposes the real row fifteen pixels below its virtual estimate.
    viewport.setTargetTop("target", 23);
    frames.runNextFrame();
    expect(viewport.scrollWrites()).toEqual([115]);
    expect(viewport.findTargetTop("target")).toBe(8);
    frames.runNextFrame();
    frames.runNextFrame();
    expect(controller.isActive()).toBe(false);
  });

  it("requires consecutive measured frames after a target temporarily unmounts", () => {
    const frames = createFakeFrameScheduler();
    const viewport = createFakeViewport();
    const controller = createController(viewport, frames);
    viewport.setTargetTop("target", 8);

    controller.start("target");
    frames.runNextFrame();
    viewport.setTargetTop("target", null);
    frames.runNextFrame();
    viewport.setTargetTop("target", 8);
    frames.runNextFrame();
    expect(controller.isActive()).toBe(true);
    frames.runNextFrame();
    expect(controller.isActive()).toBe(false);
  });

  it("scrolls toward an estimate without declaring a clamped unmounted target settled", () => {
    const frames = createFakeFrameScheduler();
    const viewport = createFakeViewport({ clientHeight: 100, scrollHeight: 220, scrollTop: 100 });
    const controller = createController(viewport, frames);
    viewport.setEstimatedTargetTop("target", 50);

    controller.start("target");
    frames.runNextFrame();
    expect(viewport.scrollWrites()).toEqual([120]);
    expect(controller.isActive()).toBe(true);
    viewport.setTargetTop("target", 30);
    frames.runNextFrame();
    expect(controller.isActive()).toBe(false);
  });

  it("keeps the same frame budget while only an estimate is available", () => {
    const frames = createFakeFrameScheduler();
    const viewport = createFakeViewport();
    const controller = createController(viewport, frames);
    viewport.setEstimatedTargetTop("target", 8);

    controller.start("target");
    for (let frame = 0; frame < 23; frame += 1) frames.runNextFrame();
    expect(controller.isActive()).toBe(true);
    frames.runNextFrame();
    expect(controller.isActive()).toBe(false);
    expect(frames.pendingFrames()).toBe(0);
  });

  it("cancels estimated navigation before a later measured target can scroll", () => {
    const frames = createFakeFrameScheduler();
    const viewport = createFakeViewport();
    const controller = createController(viewport, frames);
    viewport.setEstimatedTargetTop("target", 8);

    controller.start("target");
    frames.runNextFrame();
    viewport.emitUserIntent();
    viewport.setTargetTop("target", 23);
    expect(controller.isActive()).toBe(false);
    expect(frames.pendingFrames()).toBe(0);
    expect(viewport.scrollWrites()).toEqual([]);
  });

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
  let targetTop = 8;
  let mounted = true;
  let dropMeasurements = false;
  let offset = 1000;
  const callbacks = new Set<() => void>();
  const archivedCallbacks: Array<() => void> = [];
  const onFailure = vi.fn();
  const scrollToOffset = vi.fn((value: number) => {
    targetTop += value - offset;
    offset = value;
  });
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
      measureTarget: (_id, callback) => {
        if (!dropMeasurements)
          callback(mounted ? { top: targetTop, offset, maxOffset: 20000 } : null);
      },
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
    dropMeasurements() {
      dropMeasurements = true;
    },
    setMounted(value: boolean) {
      mounted = value;
    },
    setTargetTop(value: number) {
      targetTop = value;
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
  it("bounds a native node that never returns its measurement callback", () => {
    const f = nativeJumpFixture();
    f.succeed();
    f.dropMeasurements();
    f.controller.start("prompt");
    while (f.pending()) f.retry();
    expect(f.onFailure).toHaveBeenCalledWith("prompt");
    expect(f.controller.isActive()).toBe(false);
  });
  it("waits for a mounted bubble rather than accepting estimated index frames", () => {
    const f = nativeJumpFixture();
    f.succeed();
    f.setMounted(false);
    f.controller.start("prompt");
    f.retry();
    expect(f.controller.isActive()).toBe(true);
    expect(f.scrollToIndex).toHaveBeenCalledTimes(2);
    f.setMounted(true);
    f.retry();
    f.retry();
    expect(f.controller.isActive()).toBe(false);
  });
  it("cancels an accepted jump before its queued landing check", () => {
    const f = nativeJumpFixture();
    f.succeed();
    f.setTargetTop(180);
    f.controller.start("prompt");
    const stale = f.archivedCallbacks[0]!;
    f.controller.cancel();
    stale();
    expect(f.scrollToOffset).not.toHaveBeenCalled();
    expect(f.pending()).toBe(0);
  });
  it("corrects an accepted scroll whose cell frame settles short on the first tap", () => {
    const f = nativeJumpFixture();
    f.succeed();
    f.setTargetTop(180);
    f.controller.start("prompt");
    expect(f.controller.isActive()).toBe(true);
    f.retry();
    expect(f.scrollToOffset).toHaveBeenLastCalledWith(828, false);
    // A later layout change must invalidate the first apparent landing.
    f.setTargetTop(48);
    f.retry();
    expect(f.scrollToOffset).toHaveBeenLastCalledWith(788, false);
    f.retry();
    expect(f.controller.isActive()).toBe(true);
    f.retry();
    expect(f.controller.isActive()).toBe(false);
    expect(f.onFailure).not.toHaveBeenCalled();
  });
  it("includes long measured live header, rebases stable ID, then lands exactly", () => {
    const f = nativeJumpFixture();
    f.controller.start("prompt");
    expect(f.scrollToOffset).toHaveBeenLastCalledWith(7200, false);
    f.setIndex(14);
    f.succeed();
    f.retry();
    expect(f.scrollToIndex).toHaveBeenLastCalledWith(14);
    f.setTargetTop(8);
    f.retry();
    f.retry();
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

it("native reading preserves ordering and header geometry without ES2023 array methods", () => {
  const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, "toSorted");
  const user = (id: string): StreamItem => ({
    id,
    kind: "user_message",
    text: "prompt",
    timestamp: new Date(0),
  });
  const first = user("history-first");
  const second = user("history-second");
  const live = user("live-user");
  const answer: StreamItem = {
    id: "live-answer",
    kind: "assistant_message",
    text: "response",
    timestamp: new Date(0),
  };
  const visibleHistory = Object.freeze([
    { item: second, index: 2, isViewable: true },
    { item: user("hidden"), index: 99, isViewable: false },
    { item: first, index: 7, isViewable: true },
  ]);
  const original = [...visibleHistory];
  const input = {
    visibleHistory,
    liveHead: [live, answer],
    liveGeometry: new Map([
      [live.id, { y: 0, height: 100 }],
      [answer.id, { y: 100, height: 5900 }],
    ]),
    headerHeight: 6000,
    viewportHeight: 600,
    offsetY: 5350,
  };
  try {
    Reflect.deleteProperty(Array.prototype, "toSorted");
    expect(resolveNativeReadingPosition({ ...input, headerHeight: null })).toEqual({
      rowId: first.id,
      visibleUserIds: [first.id, second.id],
    });
    expect(resolveNativeReadingPosition(input)).toEqual({
      rowId: live.id,
      visibleUserIds: [first.id, second.id, live.id],
    });
    expect(resolveNativeReadingPosition({ ...input, offsetY: 5300 })).toEqual({
      rowId: answer.id,
      visibleUserIds: [first.id, second.id],
    });
    expect(visibleHistory).toEqual(original);
    expect(visibleHistory.map((token) => token.index)).toEqual([2, 99, 7]);
  } finally {
    if (descriptor) Reflect.defineProperty(Array.prototype, "toSorted", descriptor);
    else Reflect.deleteProperty(Array.prototype, "toSorted");
  }
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
  f.setTargetTop(8);
  f.retry();
  f.retry();
  expect(f.controller.isActive()).toBe(false);
});

describe("scroll driven prompt handoff", () => {
  it("transfers ownership exactly at the edge and reverses without overlapping alpha", () => {
    expect([8, 0, -24, -48, -100, -24, 8].map(resolvePromptHandoffProgress)).toEqual([
      0, 1, 1, 1, 1, 1, 0,
    ]);
  });
  it("accepts same-target progress without starvation and rejects stale native measurements", () => {
    const viewport: ((rect: NativePromptWindowRect | null) => void)[] = [];
    const prompts: ((rect: NativePromptWindowRect | null) => void)[] = [];
    const measured = vi.fn();
    const sampler = createNativePromptHandoffSampler({
      measureViewport: (callback) => viewport.push(callback),
      measurePrompt: (_id, callback) => prompts.push(callback),
      onMeasured: measured,
    });
    sampler.sample("first");
    sampler.sample("first");
    viewport[0]!(viewportRect(100));
    viewport[1]!(viewportRect(100));
    prompts[0]!(bubbleRect(76));
    expect(measured).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: "first",
        progress: 1,
        top: -24,
        left: 90,
        width: 180,
        viewportWidth: 320,
      }),
    );
    prompts[1]!(bubbleRect(52));
    expect(measured).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "first", progress: 1, top: -48 }),
    );
    sampler.sample("first");
    viewport[2]!(viewportRect(100));
    sampler.sample("second");
    prompts[2]!(bubbleRect(80));
    expect(measured).toHaveBeenCalledTimes(2);
    viewport[3]!(viewportRect(100));
    sampler.cancel();
    prompts[3]!(bubbleRect(60));
    expect(measured).toHaveBeenCalledTimes(2);
  });
});

it("measures both overlapping native prompts with a bounded pair", () => {
  const requests: { id: string; complete: (rect: NativePromptWindowRect | null) => void }[] = [];
  const measured = vi.fn();
  const pair = createNativePromptHandoffPair({
    measureViewport: (callback) => callback(viewportRect(100)),
    measurePrompt: (id, complete) => requests.push({ id, complete }),
    onMeasured: measured,
  });
  pair.sample(["older", "newer", "outside-budget"]);
  expect(requests.map((request) => request.id)).toEqual(["older", "newer"]);
  requests[0]!.complete(bubbleRect(80));
  requests[1]!.complete(bubbleRect(124));
  expect(measured).toHaveBeenCalledWith(
    expect.objectContaining({ id: "older", progress: 1, top: -20 }),
  );
  expect(measured).toHaveBeenCalledWith(
    expect.objectContaining({ id: "newer", progress: 0, top: 24 }),
  );
  pair.sample(["newer"]);
  pair.cancel();
  requests[2]!.complete(bubbleRect(90));
  expect(measured).toHaveBeenCalledTimes(2);
});

/** Window-space rectangles include an inset so tests prove viewport-relative positioning. */
function viewportRect(y: number): NativePromptWindowRect {
  return { x: 10, y, width: 320, height: 600 };
}
function bubbleRect(y: number): NativePromptWindowRect {
  return { x: 100, y, width: 180, height: 60, prefixHeightOne: 20, prefixHeightTwo: 40 };
}

it("ignores zero native geometry and retains actual bubble prefix extents", () => {
  const measured = vi.fn();
  let viewport = { ...viewportRect(100), width: 0 };
  const sampler = createNativePromptHandoffSampler({
    measureViewport: (complete) => complete(viewport),
    measurePrompt: (_id, complete) => complete(bubbleRect(100)),
    onMeasured: measured,
  });
  sampler.sample("prompt");
  expect(measured).not.toHaveBeenCalled();
  viewport = viewportRect(100);
  sampler.sample("prompt");
  expect(measured).toHaveBeenCalledWith(
    expect.objectContaining({
      id: "prompt",
      progress: 1,
      top: 0,
      left: 90,
      width: 180,
      prefixHeightOne: 20,
      prefixHeightTwo: 40,
    }),
  );
});

it("waits for native text layout before publishing a copy and accepts an explicit empty prefix", () => {
  const measured = vi.fn();
  let bubble: NativePromptWindowRect = {
    ...bubbleRect(99),
    prefixHeightOne: undefined,
    prefixHeightTwo: undefined,
  };
  const sampler = createNativePromptHandoffSampler({
    measureViewport: (complete) => complete(viewportRect(100)),
    measurePrompt: (_id, complete) => complete(bubble),
    onMeasured: measured,
  });
  sampler.sample("prompt");
  expect(measured).not.toHaveBeenCalled();
  bubble = bubbleRect(99);
  sampler.sample("prompt");
  expect(measured).toHaveBeenCalledWith(
    expect.objectContaining({ id: "prompt", top: -1, prefixHeightOne: 20 }),
  );
  bubble = { ...bubbleRect(100), prefixHeightOne: 0, prefixHeightTwo: 0 };
  sampler.sample("attachments-only");
  expect(measured).toHaveBeenLastCalledWith(
    expect.objectContaining({ id: "attachments-only", progress: 1, prefixHeightOne: 0 }),
  );
});

describe("explicit prompt jump placement", () => {
  it("pins a measured bubble beyond the edge, while the next original reveal retains its inset", () => {
    const frames = createFakeFrameScheduler();
    const viewport = createFakeViewport();
    const controller = createController(viewport, frames);
    viewport.setTargetTop("target", 50);
    controller.start("target", { placement: "pinned" });
    while (frames.pendingFrames()) frames.runNextFrame();
    expect(viewport.findTargetTop("target")).toBe(-2);
    controller.start("target", { placement: "original" });
    while (frames.pendingFrames()) frames.runNextFrame();
    expect(viewport.findTargetTop("target")).toBe(8);
  });

  it("does not finish pinned placement on an unmounted estimate and cancels its pending frames", () => {
    const frames = createFakeFrameScheduler();
    const viewport = createFakeViewport();
    const controller = createController(viewport, frames);
    viewport.setEstimatedTargetTop("target", -2);
    controller.start("target", { placement: "pinned" });
    frames.runNextFrame();
    frames.runNextFrame();
    expect(controller.isActive()).toBe(true);
    controller.cancel();
    expect(frames.pendingFrames()).toBe(0);
  });

  it("uses the same measured pinned destination in the inverted native controller", () => {
    const f = nativeJumpFixture();
    f.succeed();
    f.setTargetTop(8);
    f.controller.start("prompt", "pinned");
    while (f.pending()) f.retry();
    expect(f.scrollToOffset).toHaveBeenCalledWith(990, false);
    expect(f.onFailure).not.toHaveBeenCalled();
    expect(f.controller.isActive()).toBe(false);
  });
});
