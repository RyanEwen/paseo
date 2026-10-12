import { describe, expect, it } from "vitest";

import {
  hasVisibleOrderChanged,
  mergeWithRemainder,
  resolveProjectWorkspaceReorder,
} from "./sidebar-reorder";

describe("hasVisibleOrderChanged", () => {
  it("returns false when visible order is unchanged", () => {
    expect(
      hasVisibleOrderChanged({
        currentOrder: ["a", "b", "c", "d"],
        reorderedVisibleKeys: ["a", "b", "c"],
      }),
    ).toBe(false);
  });

  it("returns true when visible items are reordered", () => {
    expect(
      hasVisibleOrderChanged({
        currentOrder: ["a", "b", "c", "d"],
        reorderedVisibleKeys: ["b", "a", "c"],
      }),
    ).toBe(true);
  });

  it("returns true when a visible key is missing from current order", () => {
    expect(
      hasVisibleOrderChanged({
        currentOrder: ["a", "b"],
        reorderedVisibleKeys: ["a", "c"],
      }),
    ).toBe(true);
  });
});

describe("mergeWithRemainder", () => {
  it("appends non-visible stored keys after reordered visible keys", () => {
    expect(
      mergeWithRemainder({
        currentOrder: ["a", "x", "b", "y"],
        reorderedVisibleKeys: ["b", "a"],
      }),
    ).toEqual(["b", "a", "x", "y"]);
  });

  it("keeps unknown current keys when no visible keys are reordered", () => {
    expect(
      mergeWithRemainder({
        currentOrder: ["stale", "hidden"],
        reorderedVisibleKeys: [],
      }),
    ).toEqual(["stale", "hidden"]);
  });
});

describe("project pin reordering", () => {
  const input = {
    currentVisibleKeys: ["srv:pin1", "srv:pin2", "srv:a", "srv:b"],
    projectPinnedKeys: new Set(["srv:pin1", "srv:pin2"]),
    storedWorkspaceOrder: ["srv:a", "srv:hidden", "srv:pin1", "srv:b", "srv:pin2"],
  };
  it("does not rewrite saved workspace order when pins move or cross ordinary rows", () => {
    const result = resolveProjectWorkspaceReorder({
      ...input,
      reorderedVisibleKeys: ["srv:pin2", "srv:a", "srv:pin1", "srv:b"],
    });
    expect(result).toEqual({ projectPinKeys: ["srv:pin2", "srv:pin1"], workspaceOrder: null });
  });
  it("reorders ordinary siblings while retaining hidden and pinned saved keys", () => {
    const result = resolveProjectWorkspaceReorder({
      ...input,
      reorderedVisibleKeys: ["srv:pin2", "srv:pin1", "srv:b", "srv:a"],
    });
    expect(result).toEqual({
      projectPinKeys: ["srv:pin2", "srv:pin1"],
      workspaceOrder: ["srv:b", "srv:a", "srv:hidden", "srv:pin1", "srv:pin2"],
    });
    expect(input.storedWorkspaceOrder).toEqual([
      "srv:a",
      "srv:hidden",
      "srv:pin1",
      "srv:b",
      "srv:pin2",
    ]);
  });
});

it("treats saved project pins as ordinary rows when project pinning is disabled", () => {
  const storedWorkspaceOrder = ["srv:ordinary", "srv:pin", "srv:hidden"];
  const result = resolveProjectWorkspaceReorder({
    currentVisibleKeys: ["srv:ordinary", "srv:pin"],
    reorderedVisibleKeys: ["srv:pin", "srv:ordinary"],
    projectPinnedKeys: new Set(),
    storedWorkspaceOrder,
  });
  expect(result).toEqual({
    projectPinKeys: [],
    workspaceOrder: ["srv:pin", "srv:ordinary", "srv:hidden"],
  });
  expect(storedWorkspaceOrder).toEqual(["srv:ordinary", "srv:pin", "srv:hidden"]);
});
