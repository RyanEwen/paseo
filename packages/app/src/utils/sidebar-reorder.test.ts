import { describe, expect, it } from "vitest";

import {
  hasVisibleOrderChanged,
  mergeWithRemainder,
  moveProjectInFullOrder,
  canCommitSidebarReorder,
  sidebarReorderContext,
  sidebarReorderSort,
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

describe("anchored filtered project move", () => {
  const currentOrder = ["unknown", "host:a", "offline:x", "host:b", "hidden:y", "host:c"];
  it("moves A after the same B anchor when All is restored", () => {
    const next = moveProjectInFullOrder({
      currentOrder,
      knownProjectKeys: [],
      move: { activeKey: "host:a", overKey: "host:b", from: 0, to: 1 },
    });
    expect(next).toEqual(["unknown", "offline:x", "host:b", "host:a", "hidden:y", "host:c"]);
    expect(next?.filter((key) => key !== "host:a")).toEqual(
      currentOrder.filter((key) => key !== "host:a"),
    );
  });
  it("moves B before A for the opposite active item in the same visible swap", () => {
    expect(
      moveProjectInFullOrder({
        currentOrder,
        knownProjectKeys: [],
        move: { activeKey: "host:b", overKey: "host:a", from: 1, to: 0 },
      }),
    ).toEqual(["unknown", "host:b", "host:a", "offline:x", "hidden:y", "host:c"]);
  });
  it("materializes missing cached siblings without discarding saved unavailable keys", () => {
    expect(
      moveProjectInFullOrder({
        currentOrder: ["unknown", "host:a"],
        knownProjectKeys: ["host:a", "offline:x", "host:b"],
        move: { activeKey: "host:b", overKey: "host:a", from: 1, to: 0 },
      }),
    ).toEqual(["unknown", "host:b", "host:a", "offline:x"]);
  });
  it("does not persist a cancelled, unchanged or no-longer-known target", () => {
    expect(
      moveProjectInFullOrder({
        currentOrder,
        knownProjectKeys: [],
        move: { activeKey: "host:a", overKey: "host:a", from: 0, to: 0 },
      }),
    ).toBeNull();
    expect(
      moveProjectInFullOrder({
        currentOrder,
        knownProjectKeys: [],
        move: { activeKey: "missing", overKey: "host:a", from: 1, to: 0 },
      }),
    ).toBeNull();
  });
});

describe("Custom-only sidebar reorder domains", () => {
  const view = {
    groupMode: "project" as const,
    sortMode: "custom" as const,
    workspaceSortMode: "custom" as const,
    emptyProjectSortMode: "project" as const,
    hostFilters: [],
    projectFilters: [],
    labelFilter: { labels: [] },
    showBackground: false,
    projectVisibility: "all" as const,
    groupEmptyProjects: true,
  };
  it("uses the owning project's sort, Status empty-project sort, and workspace sort independently", () => {
    expect(sidebarReorderSort(view, "project")).toBe("custom");
    expect(sidebarReorderSort({ ...view, groupMode: "status" }, "project")).toBe("project");
    expect(sidebarReorderSort({ ...view, workspaceSortMode: "name" }, "workspace")).toBe("name");
  });
  it.each(["project", "name", "status"])(
    "rejects ordinary drops for %s without changing sort",
    (sort) => {
      expect(
        canCommitSidebarReorder({ startedContext: "same", currentContext: "same", sort }),
      ).toBe(false);
      expect(
        canCommitSidebarReorder({
          startedContext: "same",
          currentContext: "same",
          sort,
          manualPins: true,
        }),
      ).toBe(true);
    },
  );
  it("rejects stale grouping/filter contexts even for manual pins", () => {
    const startedContext = sidebarReorderContext(view, "project");
    const currentContext = sidebarReorderContext({ ...view, groupMode: "status" }, "project");
    expect(
      canCommitSidebarReorder({ startedContext, currentContext, sort: "custom", manualPins: true }),
    ).toBe(false);
    expect(sidebarReorderContext({ ...view, projectFilters: ["other"] }, "project")).not.toBe(
      startedContext,
    );
    expect(
      canCommitSidebarReorder({
        startedContext: null,
        currentContext: startedContext,
        sort: "custom",
      }),
    ).toBe(false);
  });
});
