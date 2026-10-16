import { summarizeSidebarProjectActivity } from "./sidebar-project-activity";
import { setSectionsCollapsed } from "@/stores/sidebar-collapsed-sections-store/state";
import { i18n } from "@/i18n/i18next";
import { describe, expect, it } from "vitest";
import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";
import {
  filterSidebarProjects,
  arrangeSidebarProjects,
  sortSidebarProjectsByName,
} from "./sidebar-arrangement";
import { buildSidebarProjection, resolveSidebarCollapseTargets } from "./sidebar-projection";

function makeWorkspace(
  id: string,
  statusBucket: SidebarWorkspaceEntry["statusBucket"] = "done",
  labels: string[] = [],
  projectViewKey = "project",
) {
  const placement: SidebarWorkspacePlacement = {
    workspaceKey: `srv:${id}`,
    serverId: "srv",
    workspaceId: id,
    projectViewKey,
    projectName: "Project",
    projectKind: "git",
    workspaceKind: "worktree",
    name: id,
  };
  const entry: SidebarWorkspaceEntry = {
    ...placement,
    workspaceDirectory: "",
    workspaceDirectoryLabel: "",
    title: null,
    currentBranch: null,
    statusBucket,
    statusEnteredAt: null,
    archivingAt: null,
    diffStat: null,
    prHint: null,
    archiveHasUncommittedChanges: null,
    archiveUnpushedCommitCount: null,
    scripts: [],
    hasRunningScripts: false,
    labels,
  };
  return { placement, entry };
}

function makeProject(
  workspaces: SidebarWorkspacePlacement[],
  viewKey = "project",
): SidebarProjectEntry {
  return {
    viewKey,
    projectName: "Project",
    projectKind: "git",
    iconWorkingDir: `/repo/${viewKey}`,
    hosts: [
      {
        serverId: "srv",
        projectId: viewKey,
        iconWorkingDir: `/repo/${viewKey}`,
        worktreeSupport: "supported" as const,
      },
    ],
    workspaces,
  };
}

function projectionInput(options?: {
  groupMode?: "project" | "status";
  pinnedCollapsed?: boolean;
}) {
  const pinned = makeWorkspace("pinned", "running");
  const unpinned = makeWorkspace("unpinned", "needs_input");
  return {
    projects: [makeProject([pinned.placement, unpinned.placement])],
    pinnedKeys: {
      pinnedWorkspaceKeys: [pinned.placement.workspaceKey],
      pinnedAtByKey: { [pinned.placement.workspaceKey]: "2026-07-12T12:00:00.000Z" },
    },
    pinnedWorkspaceOrder: [],
    projectPinningEnabled: true,
    workspaceSortMode: options?.groupMode === "status" ? ("status" as const) : ("custom" as const),
    workspaceTitleSource: "title" as const,
    statusWorkspaceOrder: [],
    workspaceEntriesByKey: new Map([
      [pinned.entry.workspaceKey, pinned.entry],
      [unpinned.entry.workspaceKey, unpinned.entry],
    ]),
    projectNamesByViewKey: new Map([["project", "Project"]]),
    groupMode: options?.groupMode ?? ("project" as const),
    pinnedCollapsed: options?.pinnedCollapsed ?? false,
    collapsedProjectKeys: new Set<string>(),
    collapsedWorkspaceGroupKeys: new Set<string>(),
    t: i18n.t,
  };
}

/**
 * Two projects, one workspace each, both labelled — so every grouping mode puts rows from more
 * than one project on screen, and a mode that asked for fewer icons than it renders would show it.
 */
function twoProjectInput(groupMode: "project" | "status") {
  const first = makeWorkspace("first", "running", ["Urgent"], "project");
  const second = makeWorkspace("second", "needs_input", ["Backend"], "other-project");
  return {
    ...projectionInput({ groupMode }),
    projects: [makeProject([first.placement]), makeProject([second.placement], "other-project")],
    pinnedKeys: { pinnedWorkspaceKeys: [] as string[], pinnedAtByKey: {} },
    workspaceEntriesByKey: new Map([
      [first.entry.workspaceKey, first.entry],
      [second.entry.workspaceKey, second.entry],
    ]),
    projectNamesByViewKey: new Map([
      ["project", "Project"],
      ["other-project", "Other project"],
    ]),
  };
}

describe("buildSidebarProjection", () => {
  it("sorts equal statuses newest first without changing priority, pins, ties, or saved order", () => {
    const input = projectionInput();
    const old = makeWorkspace("old");
    const newest = makeWorkspace("newest");
    const tied = makeWorkspace("tied");
    const unknown = makeWorkspace("unknown");
    const missing = makeWorkspace("missing");
    const failed = makeWorkspace("failed", "failed");
    const attention = makeWorkspace("attention", "attention");
    const running = makeWorkspace("running", "running");
    old.entry.statusEnteredAt = new Date("2026-10-04T12:00:00Z");
    newest.entry.statusEnteredAt = new Date("2026-10-11T12:00:00Z");
    tied.entry.statusEnteredAt = newest.entry.statusEnteredAt;
    const workspaces = [unknown, old, missing, newest, tied, running, attention, failed];
    input.projects[0].workspaces.push(...workspaces.map(({ placement }) => placement));
    for (const { entry } of workspaces) input.workspaceEntriesByKey.set(entry.workspaceKey, entry);
    input.workspaceEntriesByKey.delete(missing.entry.workspaceKey);
    const savedOrder = input.projects[0].workspaces.map((row) => row.name);
    const projection = buildSidebarProjection({ ...input, workspaceSortMode: "status" });
    const sorted = [
      "unpinned",
      "failed",
      "attention",
      "running",
      "newest",
      "tied",
      "old",
      "unknown",
      "missing",
    ];
    expect(projection.pinnedGroups.unpinnedProjects[0].workspaces.map((row) => row.name)).toEqual(
      sorted,
    );
    expect(projection.pinnedGroups.pinnedChats.map((row) => row.name)).toEqual(["pinned"]);
    expect(projection.shortcutModel.shortcutTargets.map((row) => row.workspaceId)).toEqual(
      ["pinned", ...sorted].slice(0, 9),
    );
    expect(input.projects[0].workspaces.map((row) => row.name)).toEqual(savedOrder);
    const custom = buildSidebarProjection(input);
    expect(custom.pinnedGroups.unpinnedProjects[0].workspaces.map((row) => row.name)).toEqual(
      savedOrder.slice(1),
    );
  });

  it("sorts workspace rows without changing pins, groups, or saved custom order", () => {
    const input = projectionInput();
    const zeta = makeWorkspace("Zeta", "done");
    const alpha = makeWorkspace("Alpha", "running");
    input.projects[0].workspaces.push(zeta.placement, alpha.placement);
    input.workspaceEntriesByKey.set(zeta.entry.workspaceKey, zeta.entry);
    input.workspaceEntriesByKey.set(alpha.entry.workspaceKey, alpha.entry);
    const named = buildSidebarProjection({ ...input, workspaceSortMode: "name" });
    expect(named.pinnedGroups.unpinnedProjects[0].workspaces.map((row) => row.name)).toEqual([
      "Alpha",
      "unpinned",
      "Zeta",
    ]);
    expect(named.pinnedGroups.pinnedChats.map((row) => row.name)).toEqual(["pinned"]);
    const status = buildSidebarProjection({ ...input, workspaceSortMode: "status" });
    expect(status.pinnedGroups.unpinnedProjects[0].workspaces.map((row) => row.name)).toEqual([
      "unpinned",
      "Alpha",
      "Zeta",
    ]);
    const custom = buildSidebarProjection({ ...input, workspaceSortMode: "custom" });
    expect(custom.pinnedGroups.unpinnedProjects[0].workspaces.map((row) => row.name)).toEqual([
      "unpinned",
      "Zeta",
      "Alpha",
    ]);
    expect(input.projects[0].workspaces.map((row) => row.name)).toEqual([
      "pinned",
      "unpinned",
      "Zeta",
      "Alpha",
    ]);
    zeta.entry.title = "Aardvark";
    const renamed = buildSidebarProjection({ ...input, workspaceSortMode: "name" });
    expect(renamed.pinnedGroups.unpinnedProjects[0].workspaces.map((row) => row.name)).toEqual([
      "Alpha",
      "unpinned",
      "Zeta",
    ]);
    expect([...renamed.shortcutModel.shortcutIndexByWorkspaceKey.keys()]).toEqual([
      "srv:pinned",
      "srv:Alpha",
      "srv:unpinned",
      "srv:Zeta",
    ]);
  });

  for (const groupMode of ["project", "status"] as const) {
    it(`sorts by visible branches with name fallback in ${groupMode} grouping`, () => {
      const alpha = makeWorkspace("Alpha");
      const zeta = makeWorkspace("Zeta");
      const fallback = makeWorkspace("Middle");
      alpha.entry.currentBranch = "zeta-branch";
      zeta.entry.currentBranch = "alpha-branch";
      zeta.entry.title = "Hidden title";
      const workspaces = [alpha, fallback, zeta];
      const projection = buildSidebarProjection({
        ...projectionInput({ groupMode }),
        projects: [makeProject(workspaces.map((workspace) => workspace.placement))],
        workspaceEntriesByKey: new Map(workspaces.map(({ entry }) => [entry.workspaceKey, entry])),
        workspaceSortMode: "name",
        workspaceTitleSource: "branch",
      });
      expect(projection.shortcutModel.shortcutTargets.map((target) => target.workspaceId)).toEqual([
        "Zeta",
        "Middle",
        "Alpha",
      ]);
    });
  }

  it("sorts within status groups and restores custom order across projects", () => {
    const input = twoProjectInput("status");
    const zeta = makeWorkspace("Zeta", "running", [], "other-project");
    const alpha = makeWorkspace("Alpha", "running");
    input.projects[0].workspaces.push(alpha.placement);
    input.projects[1].workspaces.push(zeta.placement);
    input.workspaceEntriesByKey.set(zeta.entry.workspaceKey, zeta.entry);
    input.workspaceEntriesByKey.set(alpha.entry.workspaceKey, alpha.entry);
    const named = buildSidebarProjection({ ...input, workspaceSortMode: "name" });
    expect(named.workspaceGroups.map((group) => group.key)).toEqual(["needs_input", "running"]);
    expect(named.workspaceGroups[1].rows.map((row) => row.name)).toEqual([
      "Alpha",
      "first",
      "Zeta",
    ]);
    const custom = buildSidebarProjection({
      ...input,
      workspaceSortMode: "custom",
      statusWorkspaceOrder: ["srv:Zeta", "srv:first", "srv:Alpha"],
    });
    expect(custom.workspaceGroups[1].rows.map((row) => row.name)).toEqual([
      "Zeta",
      "first",
      "Alpha",
    ]);
  });

  it("filters projects by unarchived workspace membership before splitting pins", () => {
    const input = projectionInput();
    const empty = makeProject([], "empty");
    input.projects.push(empty);
    for (const groupMode of ["project", "status"] as const) {
      const projects = filterSidebarProjects(input.projects, "unarchived");
      const projection = buildSidebarProjection({ ...input, projects, groupMode });
      expect(projects.map((project) => project.viewKey)).toEqual(["project"]);
      expect(projection.pinnedGroups.pinnedChats.map((row) => row.workspaceId)).toEqual(["pinned"]);
    }
    expect(filterSidebarProjects(input.projects, "all").map((project) => project.viewKey)).toEqual([
      "project",
      "empty",
    ]);
  });

  it("keeps empty projects available in status mode without treating all-pinned projects as empty", () => {
    const input = projectionInput({ groupMode: "status" });
    input.projects = [makeProject([input.projects[0]!.workspaces[0]!]), makeProject([], "empty")];
    const projection = buildSidebarProjection(input);
    const emptyProjects = input.projects.filter((project) => project.workspaces.length === 0);
    expect(emptyProjects.map((project) => project.viewKey)).toEqual(["empty"]);
    // Removing pinned rows must not hide the occupied project's creation action.
    expect(
      filterSidebarProjects(
        projection.pinnedGroups.unpinnedProjects,
        "unarchived",
        input.projects,
      ).map((project) => project.viewKey),
    ).toEqual(["project"]);
    expect(projection.projectIconTargets.map((target) => target.projectViewKey)).toEqual([
      "project",
      "empty",
    ]);
  });

  it("alphabetizes empty project headers while retaining their custom order and stable ties", () => {
    const zeta = { ...makeProject([], "zeta"), projectName: "Zeta" };
    const alpha = { ...makeProject([], "alpha"), projectName: "Alpha" };
    const alphaOtherHost = { ...makeProject([], "alpha-other-host"), projectName: "Alpha" };
    const emptyProjects = [zeta, alpha, alphaOtherHost];
    expect(sortSidebarProjectsByName({ projects: emptyProjects })).toEqual([
      alpha,
      alphaOtherHost,
      zeta,
    ]);
    expect(emptyProjects).toEqual([zeta, alpha, alphaOtherHost]);
  });

  it("sorts project headers by name without changing their workspace order", () => {
    const input = twoProjectInput("project");
    const extra = makeWorkspace("extra", "needs_input");
    input.projects[0]!.workspaces.push(extra.placement);
    input.workspaceEntriesByKey.set(extra.entry.workspaceKey, extra.entry);
    const projects = arrangeSidebarProjects({
      projects: input.projects,
      mode: "project",
      entries: input.workspaceEntriesByKey,
      projectNames: input.projectNamesByViewKey,
    });
    expect(projects.map((project) => project.viewKey)).toEqual(["other-project", "project"]);
    expect(projects[1]).toBe(input.projects[0]);
    expect(projects[1]!.workspaces.map((row) => row.workspaceId)).toEqual(["first", "extra"]);
    const projection = buildSidebarProjection({ ...input, projects });
    expect(projection.shortcutModel.shortcutTargets.map((target) => target.workspaceId)).toEqual([
      "second",
      "first",
      "extra",
    ]);
    expect(input.projects.map((project) => project.viewKey)).toEqual(["project", "other-project"]);
  });

  it("sorts projects by aggregate status, including pinned workspaces, and keeps ties stable", () => {
    const input = twoProjectInput("project");
    const urgent = makeWorkspace("urgent", "needs_input");
    input.projects[0]!.workspaces.push(urgent.placement);
    input.workspaceEntriesByKey.set(urgent.entry.workspaceKey, urgent.entry);
    input.pinnedKeys = { pinnedWorkspaceKeys: [urgent.placement.workspaceKey], pinnedAtByKey: {} };
    input.projects.push(makeProject([], "empty"));
    const projects = arrangeSidebarProjects({
      projects: input.projects,
      mode: "status",
      entries: input.workspaceEntriesByKey,
      projectNames: input.projectNamesByViewKey,
    });
    expect(projects.map((project) => project.viewKey)).toEqual([
      "project",
      "other-project",
      "empty",
    ]);
    expect(projects[0]!.workspaces.map((row) => row.workspaceId)).toEqual(["first", "urgent"]);
    input.workspaceEntriesByKey.get("srv:urgent")!.statusBucket = "done";
    expect(
      arrangeSidebarProjects({
        projects: input.projects,
        mode: "status",
        entries: input.workspaceEntriesByKey,
        projectNames: input.projectNamesByViewKey,
      }).map((project) => project.viewKey),
    ).toEqual(["other-project", "project", "empty"]);
    expect(
      arrangeSidebarProjects({
        projects: input.projects,
        mode: "custom",
        entries: input.workspaceEntriesByKey,
        projectNames: input.projectNamesByViewKey,
      }),
    ).toBe(input.projects);
  });

  // The rule that outlived the bug it was written for: a project icon is fetched per project, so
  // whatever a mode groups by, the rows it produces can only reference projects already covered.
  for (const groupMode of ["project", "status"] as const) {
    it(`covers every row ${groupMode} grouping renders with a project icon target`, () => {
      const projection = buildSidebarProjection(twoProjectInput(groupMode));
      const covered = new Set(projection.projectIconTargets.map((target) => target.projectViewKey));

      // Every leading visual the sidebar can paint from this projection: pinned rows, grouped
      // rows, project headers and the rows under them.
      const renderedProjectViewKeys = new Set<string>();
      for (const entry of projection.pinnedGroups.pinnedChats) {
        renderedProjectViewKeys.add(entry.projectViewKey);
      }
      for (const group of projection.workspaceGroups) {
        for (const entry of group.rows) renderedProjectViewKeys.add(entry.projectViewKey);
      }
      for (const project of projection.pinnedGroups.unpinnedProjects) {
        renderedProjectViewKeys.add(project.viewKey);
        for (const entry of project.workspaces) renderedProjectViewKeys.add(entry.projectViewKey);
      }

      expect([...renderedProjectViewKeys].sort()).toEqual(["other-project", "project"]);
      expect([...renderedProjectViewKeys].filter((viewKey) => !covered.has(viewKey))).toEqual([]);
    });
  }

  it("uses one pin-aware projection for project rows and shortcut order", () => {
    const projection = buildSidebarProjection(projectionInput());

    expect(projection.pinnedGroups.pinnedChats.map((entry) => entry.workspaceId)).toEqual([
      "pinned",
    ]);
    const remainingProject = projection.pinnedGroups.unpinnedProjects[0];
    expect(remainingProject?.workspaces.map((entry) => entry.workspaceId)).toEqual(["unpinned"]);
    expect(projection.shortcutModel.shortcutTargets).toEqual([
      { serverId: "srv", workspaceId: "pinned" },
      { serverId: "srv", workspaceId: "unpinned" },
    ]);
  });

  it("keeps pinned chats above status groups and removes them from those groups", () => {
    const projection = buildSidebarProjection(projectionInput({ groupMode: "status" }));

    expect(projection.workspaceGroups.map((group) => group.key)).toEqual(["needs_input"]);
    expect(projection.workspaceGroups[0]?.rows.map((entry) => entry.workspaceId)).toEqual([
      "unpinned",
    ]);
    expect(projection.shortcutModel.shortcutTargets).toEqual([
      { serverId: "srv", workspaceId: "pinned" },
      { serverId: "srv", workspaceId: "unpinned" },
    ]);
  });

  it("does not number pinned chats while the pinned section is collapsed", () => {
    const projection = buildSidebarProjection(
      projectionInput({ groupMode: "status", pinnedCollapsed: true }),
    );

    expect(projection.shortcutModel.shortcutTargets).toEqual([
      { serverId: "srv", workspaceId: "unpinned" },
    ]);
  });
});

describe("project workspace pins", () => {
  it.each(["custom", "name", "status"] as const)(
    "keeps pins inside their project ahead of %s sorted siblings",
    (mode) => {
      const input = projectionInput();
      const ordinary = makeWorkspace("aaa", "needs_input");
      const pin = makeWorkspace("zzz", "done");
      pin.entry.projectPinnedAt = "2026-10-11T12:00:00.000Z";
      input.projects[0]!.workspaces.push(ordinary.placement, pin.placement);
      input.workspaceEntriesByKey.set(ordinary.entry.workspaceKey, ordinary.entry);
      input.workspaceEntriesByKey.set(pin.entry.workspaceKey, pin.entry);
      const before = [...input.projects[0]!.workspaces];
      const result = buildSidebarProjection({ ...input, workspaceSortMode: mode });
      expect(result.pinnedGroups.pinnedChats.map((row) => row.workspaceKey)).toEqual([
        "srv:pinned",
      ]);
      expect(result.pinnedGroups.unpinnedProjects[0]!.workspaces[0]!.workspaceKey).toBe("srv:zzz");
      expect(
        result.shortcutModel.shortcutTargets.slice(0, 2).map((target) => target.workspaceId),
      ).toEqual(["pinned", "zzz"]);
      const collapsed = buildSidebarProjection({
        ...input,
        workspaceSortMode: mode,
        collapsedProjectKeys: new Set(["project"]),
      });
      expect(collapsed.shortcutModel.shortcutTargets.map((target) => target.workspaceId)).toEqual([
        "pinned",
      ]);
      expect(
        filterSidebarProjects(result.pinnedGroups.unpinnedProjects, "unarchived"),
      ).toHaveLength(1);
      expect(input.projects[0]!.workspaces).toEqual(before);
    },
  );

  it("uses recency and saved pin order without changing status grouping", () => {
    const input = projectionInput();
    const older = makeWorkspace("older", "needs_input");
    const newer = makeWorkspace("newer", "done");
    older.entry.projectPinnedAt = "2026-10-10T12:00:00.000Z";
    newer.entry.projectPinnedAt = "2026-10-11T12:00:00.000Z";
    input.projects[0]!.workspaces.push(older.placement, newer.placement);
    input.workspaceEntriesByKey.set(older.entry.workspaceKey, older.entry);
    input.workspaceEntriesByKey.set(newer.entry.workspaceKey, newer.entry);
    const rows = (order: string[]) =>
      buildSidebarProjection({
        ...input,
        pinnedWorkspaceOrder: order,
      }).pinnedGroups.unpinnedProjects[0]!.workspaces.map((row) => row.workspaceKey);
    expect(rows([]).slice(0, 2)).toEqual(["srv:newer", "srv:older"]);
    expect(rows(["srv:older", "srv:newer"]).slice(0, 2)).toEqual(["srv:older", "srv:newer"]);
    const status = buildSidebarProjection({ ...input, groupMode: "status" });
    expect(status.pinnedGroups.pinnedChats).toHaveLength(1);
    expect(
      status.workspaceGroups
        .flatMap((group) => group.rows)
        .filter((row) => row.workspaceKey === "srv:newer"),
    ).toHaveLength(1);
  });
});

describe("bulk collapse targets", () => {
  it("preserves hidden project and empty-group preferences when all children are globally pinned in status mode", () => {
    const input = projectionInput({ groupMode: "status" });
    const pinned = makeWorkspace("pinned", "running");
    input.projects = [makeProject([pinned.placement])];
    input.workspaceEntriesByKey = new Map([[pinned.entry.workspaceKey, pinned.entry]]);
    const projection = buildSidebarProjection(input);
    expect(
      resolveSidebarCollapseTargets({
        ...projection,
        projects: input.projects,
        groupMode: input.groupMode,
        groupEmptyProjects: true,
      }),
    ).toEqual({
      projectKeys: [],
      workspaceGroupKeys: [],
      includePinned: true,
    });
  });
  it("collapses all-pinned project headers in project mode without inventing an empty section", () => {
    const input = projectionInput({ groupMode: "project" });
    const pinned = makeWorkspace("pinned", "running");
    input.projects = [makeProject([pinned.placement])];
    input.workspaceEntriesByKey = new Map([[pinned.entry.workspaceKey, pinned.entry]]);
    const projection = buildSidebarProjection(input);
    expect(
      resolveSidebarCollapseTargets({
        ...projection,
        projects: input.projects,
        groupMode: input.groupMode,
        groupEmptyProjects: true,
      }),
    ).toEqual({ projectKeys: ["project"], workspaceGroupKeys: [], includePinned: true });
  });
  it.each(["project", "status"] as const)(
    "includes genuine empty headers and their section in %s mode",
    (groupMode) => {
      const input = projectionInput({ groupMode });
      input.projects.push(makeProject([], "empty"));
      const projection = buildSidebarProjection(input);
      const targets = resolveSidebarCollapseTargets({
        ...projection,
        projects: input.projects,
        groupMode,
        groupEmptyProjects: true,
      });
      const expectedProjects = groupMode === "project" ? ["project", "empty"] : ["empty"];
      const expectedGroups =
        groupMode === "status"
          ? ["needs_input", "no-unarchived-workspaces"]
          : ["no-unarchived-workspaces"];
      expect(targets).toEqual({
        projectKeys: expectedProjects,
        workspaceGroupKeys: expectedGroups,
        includePinned: true,
      });
      const hiddenPreferences = {
        collapsedProjectKeys: new Set(["hidden-project"]),
        collapsedWorkspaceGroupKeys: new Set(["hidden-status"]),
        collapsedPinned: false,
      };
      const collapsed = setSectionsCollapsed(hiddenPreferences, targets, true);
      expect(setSectionsCollapsed(collapsed, targets, false)).toEqual(hiddenPreferences);
      expect(
        resolveSidebarCollapseTargets({
          ...projection,
          projects: input.projects,
          groupMode,
          groupEmptyProjects: false,
        }).workspaceGroupKeys,
      ).toEqual(groupMode === "status" ? ["needs_input"] : []);
    },
  );
});

describe("optional project pinning", () => {
  it.each(["custom", "name", "status"] as const)(
    "off preserves visible rows and stored pins under %s sorting",
    (mode) => {
      const input = projectionInput();
      const projectPin = makeWorkspace("zzz", "done");
      const ordinary = makeWorkspace("aaa", "needs_input");
      projectPin.entry.projectPinnedAt = "2026-10-12T12:00:00.000Z";
      input.projects[0]!.workspaces.push(ordinary.placement, projectPin.placement);
      input.workspaceEntriesByKey.set(ordinary.entry.workspaceKey, ordinary.entry);
      input.workspaceEntriesByKey.set(projectPin.entry.workspaceKey, projectPin.entry);
      const savedRows = [...input.projects[0]!.workspaces];
      const savedPins = [projectPin.placement.workspaceKey];
      const base = { ...input, workspaceSortMode: mode, pinnedWorkspaceOrder: savedPins };
      const off = buildSidebarProjection({ ...base, projectPinningEnabled: false });
      const on = buildSidebarProjection(base);
      expect(off.pinnedGroups.pinnedChats.map((row) => row.workspaceKey)).toEqual(["srv:pinned"]);
      expect(
        off.pinnedGroups.unpinnedProjects[0]!.workspaces.map((row) => row.workspaceKey),
      ).toContain("srv:zzz");
      expect(off.pinnedGroups.unpinnedProjects[0]!.workspaces[0]!.workspaceKey).not.toBe("srv:zzz");
      expect(on.pinnedGroups.unpinnedProjects[0]!.workspaces[0]!.workspaceKey).toBe("srv:zzz");
      expect(projectPin.entry.projectPinnedAt).toBe("2026-10-12T12:00:00.000Z");
      expect(input.projects[0]!.workspaces).toEqual(savedRows);
      expect(savedPins).toEqual(["srv:zzz"]);
      const statusOn = buildSidebarProjection({ ...base, groupMode: "status" });
      const statusOff = buildSidebarProjection({
        ...base,
        groupMode: "status",
        projectPinningEnabled: false,
      });
      expect(statusOff.workspaceGroups).toEqual(statusOn.workspaceGroups);
    },
  );
});

describe("project activity summaries", () => {
  it("includes the complete selectable project catalog and all working children", () => {
    const selected = makeWorkspace("selected", "done", [], "selected-project");
    const first = makeWorkspace("first", "running", [], "other-project");
    const pinned = makeWorkspace("pinned", "running", [], "other-project");
    const projects = [
      makeProject([selected.placement], "selected-project"),
      makeProject([first.placement, pinned.placement], "other-project"),
    ];
    const entries = new Map(
      [selected, first, pinned].map(({ entry }) => [entry.workspaceKey, entry]),
    );
    const summary = summarizeSidebarProjectActivity(
      projects,
      entries,
      new Map([["srv", "online"]]),
    );
    expect(summary.get("other-project")).toEqual({ bucket: "running", workingCount: 2 });
    expect(summary.get("selected-project")).toEqual({ bucket: "done", workingCount: 0 });
  });

  it("keeps needs-input ahead of working while retaining the working count", () => {
    const first = makeWorkspace("first", "running");
    const second = makeWorkspace("second", "needs_input");
    const entries = new Map([first, second].map(({ entry }) => [entry.workspaceKey, entry]));
    expect(
      summarizeSidebarProjectActivity(
        [makeProject([first.placement, second.placement])],
        entries,
        new Map([["srv", "online"]]),
      ).get("project"),
    ).toEqual({ bucket: "needs_input", workingCount: 1 });
  });

  it("suppresses stale offline activity and avoids marking unknown or empty projects done", () => {
    const worker = makeWorkspace("worker", "running");
    const entries = new Map([[worker.entry.workspaceKey, worker.entry]]);
    const project = makeProject([worker.placement]);
    expect(
      summarizeSidebarProjectActivity([project], entries, new Map([["srv", "offline"]])).get(
        "project",
      ),
    ).toEqual({ bucket: null, workingCount: 0 });
    expect(
      summarizeSidebarProjectActivity(
        [project, makeProject([], "empty")],
        new Map(),
        new Map([["srv", "online"]]),
      ).get("project"),
    ).toEqual({ bucket: null, workingCount: 0 });
    expect(
      summarizeSidebarProjectActivity(
        [makeProject([], "empty")],
        entries,
        new Map([["srv", "online"]]),
      ).get("empty"),
    ).toEqual({ bucket: null, workingCount: 0 });
  });

  it("updates as runtime entries change without retaining a previous priority", () => {
    const worker = makeWorkspace("worker", "needs_input");
    const project = makeProject([worker.placement]);
    const online = new Map([["srv", "online"]] as const);
    expect(
      summarizeSidebarProjectActivity(
        [project],
        new Map([[worker.entry.workspaceKey, worker.entry]]),
        online,
      ).get("project")?.bucket,
    ).toBe("needs_input");
    expect(
      summarizeSidebarProjectActivity(
        [project],
        new Map([[worker.entry.workspaceKey, { ...worker.entry, statusBucket: "done" }]]),
        online,
      ).get("project")?.bucket,
    ).toBe("done");
  });
});

it("sorts Done before empty/unknown project status while preserving known priorities and stable ties", () => {
  const waiting = makeWorkspace("waiting", "needs_input");
  const failed = makeWorkspace("failed", "failed");
  const attention = makeWorkspace("attention", "attention");
  const running = makeWorkspace("running", "running");
  const doneA = makeWorkspace("done-a", "done");
  const doneB = makeWorkspace("done-b", "done");
  const unknown = makeWorkspace("unknown", "done");
  const entries = new Map(
    [waiting, failed, attention, running, doneA, doneB].map((item) => [
      item.entry.workspaceKey,
      item.entry,
    ]),
  );
  const projects = [
    makeProject([], "empty"),
    makeProject([unknown.placement], "unknown"),
    makeProject([doneB.placement], "done-b"),
    makeProject([running.placement], "running"),
    makeProject([attention.placement], "attention"),
    makeProject([failed.placement], "failed"),
    makeProject([waiting.placement], "waiting"),
    makeProject([doneA.placement], "done-a"),
  ];
  const activity = summarizeSidebarProjectActivity(projects, entries, new Map([["srv", "online"]]));
  expect(
    arrangeSidebarProjects({
      projects,
      mode: "status",
      entries,
      projectNames: new Map(),
      projectActivity: activity,
    }).map((project) => project.viewKey),
  ).toEqual(["waiting", "failed", "attention", "running", "done-b", "done-a", "empty", "unknown"]);
  expect(projects[0]!.viewKey).toBe("empty");
});

it("places a cached offline project after online Done using the same activity as its no-status badge", () => {
  const offline = makeWorkspace("cached", "running");
  offline.placement.serverId = "offline";
  const done = makeWorkspace("done", "done");
  const entries = new Map([
    [offline.entry.workspaceKey, offline.entry],
    [done.entry.workspaceKey, done.entry],
  ]);
  const projects = [
    makeProject([offline.placement], "offline"),
    makeProject([done.placement], "done"),
  ];
  const activity = summarizeSidebarProjectActivity(
    projects,
    entries,
    new Map([
      ["srv", "online"],
      ["offline", "offline"],
    ]),
  );
  expect(
    arrangeSidebarProjects({
      projects,
      mode: "status",
      entries,
      projectNames: new Map(),
      projectActivity: activity,
    }).map((project) => project.viewKey),
  ).toEqual(["done", "offline"]);
});
