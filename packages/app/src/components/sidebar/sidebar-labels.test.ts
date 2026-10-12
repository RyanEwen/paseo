import { limitSidebarWorkspaces, parseSidebarWorkspaceCount } from "./workspace-limit";
import { describe, expect, test } from "vitest";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { SIDEBAR_UNLABELLED_LABEL_KEY } from "@/stores/sidebar-view-store";
import { buildStatusListItems, statusListItemKey } from "./status-list-items";
import type { SidebarWorkspaceGroup } from "./sidebar-labels";
import { filterWorkspacesByLabels } from "./sidebar-labels";

function workspace(
  workspaceId: string,
  labels: string[],
  pinnedAt: string | null = null,
): SidebarWorkspaceEntry {
  return {
    workspaceKey: `host:${workspaceId}`,
    serverId: "host",
    workspaceId,
    projectViewKey: "project",
    projectName: "Project",
    projectRootPath: "/repo",
    workspaceDirectory: `/repo/${workspaceId}`,
    workspaceDirectoryLabel: workspaceId,
    projectKind: "git",
    workspaceKind: "worktree",
    name: workspaceId,
    title: null,
    pinnedAt,
    labels,
    currentBranch: "main",
    statusBucket: "done",
    statusEnteredAt: null,
    archivingAt: null,
    diffStat: null,
    prHint: null,
    archiveHasUncommittedChanges: null,
    archiveUnpushedCommitCount: null,
    scripts: [],
    hasRunningScripts: false,
  };
}

describe("sidebar label filtering", () => {
  const workspaces = [
    workspace("one", ["Backend", "Urgent"], "2026-01-01"),
    workspace("two", ["Backend"]),
    workspace("three", []),
  ];

  function filtered(labels: string[]) {
    return filterWorkspacesByLabels({ workspaces, labels }).map((entry) => entry.workspaceId);
  }

  test("includes a workspace carrying any selected label", () => {
    expect(filtered([])).toEqual(["one", "two", "three"]);
    expect(filtered(["backend"])).toEqual(["one", "two"]);
    expect(filtered(["backend", "urgent"])).toEqual(["one", "two"]);
  });

  test("models Unlabelled as a row in the same list", () => {
    expect(filtered([SIDEBAR_UNLABELLED_LABEL_KEY])).toEqual(["three"]);
    expect(filtered(["backend", SIDEBAR_UNLABELLED_LABEL_KEY])).toEqual(["one", "two", "three"]);
  });

  test("reads whitespace-only label names as no label rather than as the Unlabelled key", () => {
    expect(
      filterWorkspacesByLabels({
        workspaces: [workspace("blank", ["   "])],
        labels: [SIDEBAR_UNLABELLED_LABEL_KEY],
      }).map((entry) => entry.workspaceId),
    ).toEqual(["blank"]);
  });
});

describe("stable status-list cells", () => {
  function group(key: "running" | "done", rows: SidebarWorkspaceEntry[]): SidebarWorkspaceGroup {
    return { key, label: key, leading: { kind: "status", bucket: key }, rows };
  }
  const first = workspace("first", []);
  const second = workspace("second", []);

  test("retains a workspace cell key when status moves it across group boundaries", () => {
    const before = buildStatusListItems({
      groups: [group("running", [first]), group("done", [second])],
      collapsedGroupKeys: new Set(),
      initialCount: 20,
      expandedGroupKeys: new Set(),
    });
    const after = buildStatusListItems({
      groups: [group("done", [second, first])],
      collapsedGroupKeys: new Set(),
      initialCount: 20,
      expandedGroupKeys: new Set(),
    });
    const find = (items: ReturnType<typeof buildStatusListItems>) =>
      items.find(
        (item) => item.kind === "workspace" && item.workspace.workspaceId === first.workspaceId,
      )!;
    expect(statusListItemKey(find(before))).toBe(statusListItemKey(find(after)));
    expect(after.filter((item) => item.kind === "workspace")).toHaveLength(2);
  });

  test("keeps per-group collapse and Show more limits independent", () => {
    const many = Array.from({ length: 21 }, (_, i) => workspace(String(i), []));
    const groups = [group("running", many), group("done", [second])];
    const items = buildStatusListItems({
      groups,
      collapsedGroupKeys: new Set(["done"]),
      initialCount: 20,
      expandedGroupKeys: new Set(),
    });
    expect(items.filter((item) => item.kind === "workspace")).toHaveLength(20);
    expect(items.find((item) => item.kind === "footer")).toMatchObject({
      groupKey: "running",
      expanded: false,
      canToggle: true,
    });
    const expanded = buildStatusListItems({
      groups,
      collapsedGroupKeys: new Set(["done"]),
      initialCount: 20,
      expandedGroupKeys: new Set(["running"]),
    });
    expect(expanded.filter((item) => item.kind === "workspace")).toHaveLength(21);
    expect(expanded.filter((item) => item.kind === "header")).toHaveLength(2);
  });
  test("uses the same configurable policy for status groups and project/pinned groups", () => {
    const rows = Array.from({ length: 25 }, (_, i) => workspace(String(i), []));
    const keys = rows.map((row) => row.workspaceKey);
    const expandedGroupKeys = new Set(["running"]);
    const collapsedGroupKeys = new Set(["done"]);
    for (const initialCount of [1, 7, 20, 25, 37, null]) {
      for (const expanded of [false, true]) {
        const projection = limitSidebarWorkspaces({ items: rows, initialCount, expanded });
        const items = buildStatusListItems({
          groups: [group("running", rows), group("done", rows)],
          initialCount,
          expandedGroupKeys: expanded ? expandedGroupKeys : new Set(),
          collapsedGroupKeys,
        });
        expect(
          items.filter((item) => item.kind === "workspace").map((item) => item.workspace),
        ).toEqual(projection.visibleItems);
        expect(items.find((item) => item.kind === "footer")).toMatchObject({
          canToggle: projection.canToggle,
          expanded,
        });
        expect(items.filter((item) => item.kind === "header")).toHaveLength(2);
        expect(rows.map((row) => row.workspaceKey)).toEqual(keys);
        expect(expandedGroupKeys).toEqual(new Set(["running"]));
        expect(collapsedGroupKeys).toEqual(new Set(["done"]));
      }
    }
    const all = buildStatusListItems({
      groups: [group("running", rows)],
      initialCount: null,
      expandedGroupKeys,
      collapsedGroupKeys,
    });
    const limited = buildStatusListItems({
      groups: [group("running", rows)],
      initialCount: 1,
      expandedGroupKeys,
      collapsedGroupKeys,
    });
    expect(all.filter((item) => item.kind === "workspace").map(statusListItemKey)).toEqual(
      limited.filter((item) => item.kind === "workspace").map(statusListItemKey),
    );
  });

  test("accepts arbitrary positive safe integers without coercing invalid input", () => {
    for (const text of ["", "0", "-1", "2.5", "2e3", "12x", "Infinity", "9007199254740992"]) {
      expect(parseSidebarWorkspaceCount(text)).toBeNull();
    }
    expect(parseSidebarWorkspaceCount(" 37 ")).toBe(37);
    expect(parseSidebarWorkspaceCount("001")).toBe(1);
    expect(parseSidebarWorkspaceCount(String(Number.MAX_SAFE_INTEGER))).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });
});
