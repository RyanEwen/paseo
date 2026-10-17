import { describe, expect, it } from "vitest";
import { computeResizeHandleSizes } from "@/components/resize-handle-sizes";

describe("computeResizeHandleSizes", () => {
  it("clamps right-edge drags to the adjacent pane minimum", () => {
    const sizes = computeResizeHandleSizes({
      sizes: [0.25, 0.5, 0.25],
      index: 1,
      deltaRatio: 0.5,
    });

    expect(sizes[0]).toBe(0.25);
    expect(sizes[1]).toBe(0.65);
    expect(sizes[2]).toBeCloseTo(0.1, 10);
  });

  it("clamps left-edge drags to the adjacent pane minimum", () => {
    const sizes = computeResizeHandleSizes({
      sizes: [0.25, 0.5, 0.25],
      index: 1,
      deltaRatio: -0.5,
    });

    expect(sizes[0]).toBe(0.25);
    expect(sizes[1]).toBe(0.1);
    expect(sizes[2]).toBeCloseTo(0.65, 10);
  });

  it("moves adjacent pane sizes without clamping", () => {
    const sizes = computeResizeHandleSizes({
      sizes: [0.25, 0.5, 0.25],
      index: 1,
      deltaRatio: 0.05,
    });

    expect(sizes[0]).toBe(0.25);
    expect(sizes[1]).toBe(0.55);
    expect(sizes[2]).toBeCloseTo(0.2, 10);
  });

  it("splits tiny adjacent pairs evenly when the configured minimum cannot fit", () => {
    expect(
      computeResizeHandleSizes({
        sizes: [0.45, 0.05, 0.05, 0.45],
        index: 1,
        deltaRatio: 0.05,
      }),
    ).toEqual([0.45, 0.05, 0.05, 0.45]);
  });

  it("leaves sizes unchanged when the adjacent pair is invalid", () => {
    expect(
      computeResizeHandleSizes({
        sizes: [0.25, 0.5, 0.25],
        index: 3,
        deltaRatio: 0.25,
      }),
    ).toEqual([0.25, 0.5, 0.25]);
    expect(
      computeResizeHandleSizes({
        sizes: [0.25, 0, 0, 0.75],
        index: 1,
        deltaRatio: 0.25,
      }),
    ).toEqual([0.25, 0, 0, 0.75]);
  });
});

import { applySplitLayoutPreset, canApplySplitLayoutPreset } from "./split-layout-presets";

describe("split layout presets", () => {
  it("changes only the adjacent pair and preserves its total", () => {
    const result = applySplitLayoutPreset([0.2, 0.5, 0.3], 1, 0.6);
    expect(result[0]).toBe(0.2);
    expect(result[1]).toBeCloseTo(0.48);
    expect(result[2]).toBeCloseTo(0.32);
  });
  it("disables ratios that cannot fit the normal pane minimum", () => {
    expect(canApplySplitLayoutPreset([0.8, 0.1, 0.1], 1, 0.6)).toBe(false);
    expect(canApplySplitLayoutPreset([0.8, 0.1, 0.1], 1, 0.5)).toBe(true);
    expect(canApplySplitLayoutPreset([0.5, 0.5], 0, 0.7)).toBe(true);
  });
  it("rejects missing dividers and invalid fractions", () => {
    expect(applySplitLayoutPreset([0.5, 0.5], 1, 0.6)).toEqual([0.5, 0.5]);
    expect(applySplitLayoutPreset([0.5, 0.5], 0, NaN)).toEqual([0.5, 0.5]);
    expect(canApplySplitLayoutPreset([0.5, 0.5], 0, 1)).toBe(false);
  });
});
