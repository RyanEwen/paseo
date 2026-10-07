import { test } from "../support/fixtures";
import { expect } from "@playwright/test";
import { expectVirtualizationHandoffContinuity } from "../support/helpers/timeline-virtualization-handoff";
import { expectShrinkingImageContinuity } from "../support/helpers/timeline-image-continuity";
import {
  findScrollJumps,
  expectImageSpaceReserved,
  type ScrollFrame,
  observeTimelinePages,
  openOnlyTimelineTail,
  recordUpwardTraversal,
  reportScrollJumps,
  scrollCadences,
  withVariedTimeline,
} from "../support/helpers/timeline-scroll-smoothness";

/** Create a recorded frame with neutral counters so cases focus on measured geometry and input. */
function createScrollFrame(overrides: Partial<ScrollFrame>): ScrollFrame {
  return {
    at: 1000,
    scrollTop: 1000,
    scrollHeight: 5000,
    viewportHeight: 800,
    virtualized: true,
    loading: false,
    rows: [],
    anchor: null,
    wheelTotal: 0,
    lastWheelAt: 0,
    inputFinishedAt: null,
    imageLoads: 0,
    mounted: 0,
    unmounted: 0,
    ...overrides,
  };
}

/** Shift captured viewport geometry without mutating the reference frame. */
function moveRecordedRows(rows: ScrollFrame["rows"], pixels: number): ScrollFrame["rows"] {
  return rows.map((row) => ({
    id: row.id,
    top: row.top + pixels,
    height: row.height,
    isImage: row.isImage,
  }));
}

test("scroll detector separates portrait growth from compensated content coordinates", () => {
  for (const [imageTop, compensation] of [
    [-704, 110],
    [-683, 131],
  ]) {
    const before = createScrollFrame({
      scrollTop: 2167,
      wheelTotal: 160,
      anchor: "prompt",
      rows: [
        { id: "image", top: imageTop, height: 560 },
        { id: "caption", top: imageTop + 560, height: 100 },
        { id: "prompt", top: imageTop + 660, height: 106 },
      ],
    });
    const after = createScrollFrame({
      ...before,
      at: 1040,
      scrollTop: before.scrollTop - 160 - compensation,
      scrollHeight: before.scrollHeight + 1072 - compensation,
      wheelTotal: 320,
      lastWheelAt: 1030,
      anchor: "image",
      imageLoads: 1,
      rows: [
        { id: "image", top: imageTop + 160, height: 1632 },
        { id: "caption", top: imageTop + 1792, height: 100 },
        { id: "prompt", top: imageTop + 1892, height: 106 },
      ],
    });
    expect(findScrollJumps([before, after])).toEqual([]);
    for (const displacement of [100, -500]) {
      expect(
        findScrollJumps([before, { ...after, rows: moveRecordedRows(after.rows, displacement) }]),
      ).toHaveLength(1);
    }
    expect(
      findScrollJumps([
        { ...before, inputFinishedAt: 0 },
        { ...after, inputFinishedAt: 0 },
      ]),
    ).toHaveLength(1);
  }
});

test("scroll detector checks visible following text during image shrink", () => {
  const before = createScrollFrame({
    anchor: "image",
    rows: [
      { id: "image", isImage: true, top: -517, height: 560 },
      { id: "text", top: 43, height: 130 },
    ],
  });
  const after = createScrollFrame({
    ...before,
    at: 1040,
    rows: [
      { id: "image", isImage: true, top: -182, height: 225 },
      { id: "text", top: 43, height: 130 },
    ],
  });
  expect(findScrollJumps([before, after])).toEqual([]);
  for (const displacement of [-335, 100]) {
    expect(
      findScrollJumps([
        before,
        { ...after, rows: [after.rows[0]!, { ...after.rows[1]!, top: 43 + displacement }] },
      ]),
    ).toHaveLength(1);
  }
  expect(
    findScrollJumps([
      { ...before, inputFinishedAt: 0 },
      { ...after, inputFinishedAt: 0, rows: [after.rows[0]!, { ...after.rows[1]!, top: 60 }] },
    ]),
  ).toHaveLength(1);
});

test("scroll detector retains wheel input during image boundary compensation", () => {
  for (const [imageTop, wheel] of [
    [-514, 480],
    [-274, 1200],
  ]) {
    const before = createScrollFrame({
      anchor: "image",
      rows: [
        { id: "above", top: imageTop - 212, height: 212 },
        { id: "image", isImage: true, top: imageTop, height: 560 },
        { id: "text", top: imageTop + 560, height: 130 },
      ],
    });
    const compensated = createScrollFrame({
      ...before,
      at: 1040,
      wheelTotal: wheel,
      lastWheelAt: 1030,
      anchor: imageTop === -274 ? "above" : "image",
      rows: [
        { id: "above", top: imageTop + 123, height: 212 },
        { id: "image", isImage: true, top: imageTop + 335, height: 225 },
        { id: "text", top: imageTop + 560, height: 130 },
      ],
    });
    const moved = createScrollFrame({
      ...compensated,
      at: 1050,
      rows: moveRecordedRows(compensated.rows, wheel),
    });
    expect(findScrollJumps([before, compensated, moved])).toEqual([]);
    expect(
      findScrollJumps([before, compensated, { ...moved, rows: moveRecordedRows(moved.rows, 100) }]),
    ).toHaveLength(1);
  }
});

test("scroll detector retains delayed wheel input when an image shrinks above the text reader", () => {
  for (const [imageTop, textTop, textHeight] of [
    [-621, -61, 130],
    [-748, -58, 81],
  ]) {
    // Captured medium-scroll failures: the text stays fixed while the image
    // contracts above it. Its obsolete height must not turn compensation into input.
    const before = createScrollFrame({
      anchor: "text",
      rows: [
        { id: "image", isImage: true, top: imageTop, height: 560 },
        ...(textTop === -58 ? [{ id: "code", top: -188, height: 130 }] : []),
        { id: "text", top: textTop, height: textHeight },
      ],
    });
    const compensated = createScrollFrame({
      ...before,
      at: 1040,
      wheelTotal: 480,
      lastWheelAt: 1030,
      rows: before.rows.map((row) =>
        row.isImage ? { ...row, top: row.top + 335, height: 225 } : row,
      ),
    });
    const moved = createScrollFrame({
      ...compensated,
      at: 1050,
      rows: moveRecordedRows(compensated.rows, 480),
    });
    expect(findScrollJumps([before, compensated, moved])).toEqual([]);
    for (const movement of [580, -100]) {
      expect(
        findScrollJumps([
          before,
          compensated,
          { ...moved, rows: moveRecordedRows(compensated.rows, movement) },
        ]),
      ).toHaveLength(1);
    }
    expect(
      findScrollJumps([
        { ...before, inputFinishedAt: 0 },
        { ...compensated, inputFinishedAt: 0 },
        { ...moved, inputFinishedAt: 0, rows: moveRecordedRows(compensated.rows, 17) },
      ]),
    ).toHaveLength(1);
  }
});

test("scroll detector keeps image shrink past the reading line blocking", () => {
  const before = createScrollFrame({
    scrollTop: 3418,
    anchor: "code",
    rows: [
      { id: "image", top: -677, height: 560 },
      { id: "code", top: -117, height: 130 },
      { id: "quote", top: 13, height: 81 },
      { id: "list", top: 94, height: 91 },
    ],
  });
  const after = createScrollFrame({
    ...before,
    at: 1040,
    scrollTop: 3246,
    wheelTotal: 160,
    lastWheelAt: 1030,
    anchor: "list",
    imageLoads: 1,
    rows: [
      { id: "image", top: -517, height: 225 },
      { id: "code", top: -292, height: 130 },
      { id: "quote", top: -162, height: 81 },
      { id: "list", top: -81, height: 91 },
    ],
  });
  expect(findScrollJumps([before, after])).toMatchObject([{ movement: -175 }]);
});

test("scroll detector distinguishes entered image growth from a simultaneous viewport jump", () => {
  const before = createScrollFrame({
    at: 1000,
    scrollTop: 1000,
    scrollHeight: 5000,
    viewportHeight: 800,
    virtualized: true,
    loading: false,
    rows: [
      { id: "image", top: -150, height: 150 },
      { id: "reading", top: 0, height: 100 },
    ],
    anchor: "reading",
    wheelTotal: 0,
    lastWheelAt: 0,
    inputFinishedAt: null,
    imageLoads: 0,
    mounted: 0,
    unmounted: 0,
  });
  const after: ScrollFrame = {
    ...before,
    at: 1400,
    scrollTop: 900,
    wheelTotal: 100,
    lastWheelAt: 1050,
    rows: [
      { id: "image", top: -50, height: 1150 },
      { id: "reading", top: 1100, height: 100 },
    ],
  };
  expect(findScrollJumps([before, after])).toEqual([]);
  expect(
    findScrollJumps([
      { ...before, scrollTop: 200 },
      {
        ...after,
        wheelTotal: 1000,
        scrollTop: 0,
        rows: moveRecordedRows(after.rows, 100),
      },
    ]),
  ).toEqual([]);
  expect(
    findScrollJumps([before, { ...after, rows: moveRecordedRows(after.rows, -500) }]),
  ).toHaveLength(1);
  expect(
    findScrollJumps([
      { ...before, anchor: "image", rows: [{ id: "image", top: 0, height: 150 }] },
      { ...after, rows: [{ id: "image", top: 600, height: 1150 }] },
    ]),
  ).toHaveLength(1);
});

test("scroll detector accounts for delayed wheel input and growth below the new reader", () => {
  const before = createScrollFrame({
    at: 1000,
    scrollTop: 2000,
    scrollHeight: 5000,
    viewportHeight: 800,
    virtualized: true,
    loading: false,
    rows: [
      { id: "new-reader", top: -520, height: 278 },
      { id: "image", top: -242, height: 184 },
      { id: "old-reader", top: -58, height: 130 },
    ],
    anchor: "old-reader",
    wheelTotal: 0,
    lastWheelAt: 0,
    inputFinishedAt: null,
    imageLoads: 0,
    mounted: 0,
    unmounted: 0,
  });
  const wheel = { ...before, at: 1100, wheelTotal: 480, lastWheelAt: 1099 };
  const after: ScrollFrame = {
    ...wheel,
    at: 1220,
    scrollTop: 1520,
    scrollHeight: 5041,
    anchor: "new-reader",
    rows: [
      { id: "new-reader", top: -40, height: 278 },
      { id: "image", top: 238, height: 225 },
      { id: "old-reader", top: 463, height: 130 },
    ],
  };
  expect(findScrollJumps([before, wheel, after])).toEqual([]);
  // The previous 480 px input has already moved the viewport; the recent
  // budget includes it, but only the next 480 px belongs to this frame.
  const steadyBefore = { ...before, at: 1050, wheelTotal: 480, lastWheelAt: 1049 };
  const steadyAfter = {
    ...after,
    at: 1100,
    wheelTotal: 960,
    lastWheelAt: 1099,
    scrollHeight: 6000,
    rows: [
      { id: "new-reader", top: -40, height: 278 },
      { id: "image", top: 238, height: 1184 },
      { id: "old-reader", top: 1422, height: 130 },
    ],
  };
  expect(findScrollJumps([steadyBefore, steadyAfter])).toEqual([]);

  expect(
    findScrollJumps([
      before,
      wheel,
      {
        ...after,
        rows: moveRecordedRows(after.rows, 100),
      },
    ]),
  ).toHaveLength(1);
});

for (const cadence of scrollCadences) {
  test(`varied timeline preserves reading position during ${cadence.name} upward scrolling`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    await withVariedTimeline(async (agent, newestPrompt) => {
      const pages = observeTimelinePages(page, agent.agentId);
      await openOnlyTimelineTail(page, agent, newestPrompt, pages);
      const frames = await recordUpwardTraversal(page, cadence, testInfo);
      await reportScrollJumps(page, testInfo, frames, pages);
    });
  });
}

test("reserves image space before its response arrives", async ({ page }, testInfo) => {
  await expectImageSpaceReserved(page, testInfo);
});

for (const order of ["wheel-first", "resize-first"] as const) {
  test(`shrinking image preserves visible text with ${order} input`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await expectShrinkingImageContinuity(page, testInfo, order);
  });
}

test("virtualization handoff preserves a nonzero reading offset", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await expectVirtualizationHandoffContinuity(page, testInfo);
});
