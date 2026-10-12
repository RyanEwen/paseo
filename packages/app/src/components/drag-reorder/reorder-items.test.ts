import { describe, expect, it } from "vitest";
import { isDragGroupOrderValid, reorderItemsOnDragEnd } from "./reorder-items";

const items = ["alpha", "beta", "gamma"];
const byValue = (item: string): string => item;

describe("reorderItemsOnDragEnd", () => {
  it("moves the active item to the over position", () => {
    expect(
      reorderItemsOnDragEnd({
        items,
        activeId: "alpha",
        overId: "gamma",
        keyExtractor: byValue,
      }),
    ).toEqual(["beta", "gamma", "alpha"]);
  });

  it("is a no-op when the drop target is missing", () => {
    expect(
      reorderItemsOnDragEnd({
        items,
        activeId: "alpha",
        overId: null,
        keyExtractor: byValue,
      }),
    ).toBeNull();
  });

  it("is a no-op when the active and over items are the same", () => {
    expect(
      reorderItemsOnDragEnd({
        items,
        activeId: "beta",
        overId: "beta",
        keyExtractor: byValue,
      }),
    ).toBeNull();
  });

  it("is a no-op when the active id is not in the list", () => {
    expect(
      reorderItemsOnDragEnd({
        items,
        activeId: "delta",
        overId: "beta",
        keyExtractor: byValue,
      }),
    ).toBeNull();
  });

  it("is a no-op when the over id is not in the list", () => {
    expect(
      reorderItemsOnDragEnd({
        items,
        activeId: "alpha",
        overId: "delta",
        keyExtractor: byValue,
      }),
    ).toBeNull();
  });
});

describe("group-bounded dragging", () => {
  const grouped = ["header-a", "a1", "a2", "footer-a", "header-b", "b1", "b2"];
  const groupKey = (item: string) => (/^[ab]\d$/.test(item) ? item.slice(0, 1) : null);

  it("allows a reorder within a group", () => {
    const reordered = reorderItemsOnDragEnd({
      items: grouped,
      activeId: "a1",
      overId: "a2",
      keyExtractor: byValue,
      getDragGroupKey: groupKey,
    });
    expect(reordered).toEqual(["header-a", "a2", "a1", "footer-a", "header-b", "b1", "b2"]);
    expect(
      isDragGroupOrderValid({
        original: grouped,
        reordered: reordered!,
        keyExtractor: byValue,
        getDragGroupKey: groupKey,
      }),
    ).toBe(true);
  });

  it("rejects headers, footers, and cross-group drop targets", () => {
    for (const [activeId, overId] of [
      ["header-a", "a1"],
      ["a1", "footer-a"],
      ["a2", "b1"],
    ]) {
      expect(
        reorderItemsOnDragEnd({
          items: grouped,
          activeId: activeId!,
          overId: overId!,
          keyExtractor: byValue,
          getDragGroupKey: groupKey,
        }),
      ).toBeNull();
    }
  });

  it("rejects native results that displace a boundary or duplicate a row", () => {
    for (const reordered of [
      ["header-a", "a2", "footer-a", "a1", "header-b", "b1", "b2"],
      ["header-a", "a2", "a2", "footer-a", "header-b", "b1", "b2"],
      ["header-a", "a1", "b1", "footer-a", "header-b", "a2", "b2"],
      grouped.slice(1),
    ]) {
      expect(
        isDragGroupOrderValid({
          original: grouped,
          reordered,
          keyExtractor: byValue,
          getDragGroupKey: groupKey,
        }),
      ).toBe(false);
    }
  });
});
