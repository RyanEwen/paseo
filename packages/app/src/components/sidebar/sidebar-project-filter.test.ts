import { describe, expect, test } from "vitest";
import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
} from "@/hooks/use-sidebar-workspaces-list";
import {
  filterWorkspacesByProjects,
  includeCreatedProjectFilter,
  resolveActiveProjectFilters,
  resolveSidebarProjectLabels,
} from "./sidebar-project-filter";

function workspace(workspaceId: string, projectViewKey: string): SidebarWorkspaceEntry {
  return {
    workspaceKey: `host:${workspaceId}`,
    serverId: "host",
    workspaceId,
    projectViewKey,
    projectName: projectViewKey,
    projectRootPath: `/repo/${projectViewKey}`,
    workspaceDirectory: `/repo/${projectViewKey}/${workspaceId}`,
    workspaceDirectoryLabel: workspaceId,
    projectKind: "git",
    workspaceKind: "worktree",
    name: workspaceId,
    title: null,
    pinnedAt: null,
    labels: [],
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

describe("resolveActiveProjectFilters", () => {
  test("reads an empty stored filter as every project", () => {
    expect(resolveActiveProjectFilters([], new Set(["alpha", "beta"]))).toEqual([]);
  });

  test("keeps only the keys that still name a project it can see", () => {
    expect(resolveActiveProjectFilters(["alpha", "gone"], new Set(["alpha", "beta"]))).toEqual([
      "alpha",
    ]);
    expect(resolveActiveProjectFilters(["alpha", "beta"], new Set(["alpha", "beta"]))).toEqual([
      "alpha",
      "beta",
    ]);
  });

  // Nothing deletes the stored keys, so a filter naming only projects on a host that has not
  // connected yet must go inert rather than blank the sidebar. It comes back with the host.
  test("goes inert instead of matching nothing", () => {
    expect(resolveActiveProjectFilters(["alpha"], new Set(["beta"]))).toEqual([]);
    expect(resolveActiveProjectFilters(["alpha"], new Set())).toEqual([]);
  });
});

describe("includeCreatedProjectFilter", () => {
  const projects = [
    {
      viewKey: "alpha",
      hosts: [
        {
          serverId: "home",
          projectId: "old",
          iconWorkingDir: "/old",
          worktreeSupport: "supported" as const,
        },
      ],
    },
    {
      viewKey: "new-shared-key",
      hosts: [
        {
          serverId: "home",
          projectId: "new",
          iconWorkingDir: "/new",
          worktreeSupport: "supported" as const,
        },
      ],
    },
    {
      viewKey: '["remote","new"]',
      hosts: [
        {
          serverId: "remote",
          projectId: "new",
          iconWorkingDir: "/remote",
          worktreeSupport: "supported" as const,
        },
      ],
    },
  ];

  test("appends the created project's actual view key and preserves existing and offline choices", () => {
    const result = includeCreatedProjectFilter({
      projectFilters: ["alpha", "offline"],
      projects,
      serverId: "home",
      projectId: "new",
    });
    expect(result).toEqual(["alpha", "offline", "new-shared-key"]);
    expect(
      resolveActiveProjectFilters(result, new Set(projects.map((project) => project.viewKey))),
    ).toEqual(["alpha", "new-shared-key"]);
  });

  test("uses the host-specific placement when project IDs collide", () => {
    expect(
      includeCreatedProjectFilter({
        projectFilters: ["alpha"],
        projects,
        serverId: "remote",
        projectId: "new",
      }),
    ).toEqual(["alpha", '["remote","new"]']);
  });

  test.each([{ projectFilters: [] }, { projectFilters: ["offline"] }])(
    "preserves the all-projects view for stored selection $projectFilters",
    ({ projectFilters }) => {
      expect(
        includeCreatedProjectFilter({
          projectFilters,
          projects,
          serverId: "home",
          projectId: "new",
        }),
      ).toBe(projectFilters);
    },
  );

  test("does not toggle an already visible project off", () => {
    const projectFilters = ["alpha", "new-shared-key"];
    expect(
      includeCreatedProjectFilter({ projectFilters, projects, serverId: "home", projectId: "new" }),
    ).toBe(projectFilters);
  });

  test("leaves projects outside the current host projection unchanged", () => {
    const projectFilters = ["alpha"];
    expect(
      includeCreatedProjectFilter({
        projectFilters,
        projects: projects.slice(0, 1),
        serverId: "remote",
        projectId: "new",
      }),
    ).toBe(projectFilters);
  });
});

describe("filterWorkspacesByProjects", () => {
  const workspaces = [
    workspace("one", "alpha"),
    workspace("two", "alpha"),
    workspace("three", "beta"),
  ];

  function filtered(projectFilters: string[]) {
    return filterWorkspacesByProjects({ workspaces, projectFilters }).map(
      (entry) => entry.workspaceId,
    );
  }

  test("keeps every workspace when nothing is pinned", () => {
    expect(filtered([])).toEqual(["one", "two", "three"]);
  });

  test("keeps the workspaces of the pinned projects", () => {
    expect(filtered(["alpha"])).toEqual(["one", "two"]);
    expect(filtered(["beta"])).toEqual(["three"]);
    expect(filtered(["alpha", "beta"])).toEqual(["one", "two", "three"]);
  });

  test("keeps nothing for a project with no workspaces", () => {
    expect(filtered(["gamma"])).toEqual([]);
  });
});

describe("resolveSidebarProjectLabels", () => {
  function project(
    viewKey: string,
    projectName: string,
    serverId: string,
    path = "/repo",
  ): SidebarProjectEntry {
    return {
      viewKey,
      projectName,
      projectKind: "git",
      iconWorkingDir: path,
      hosts: [{ serverId, projectId: viewKey, iconWorkingDir: path, worktreeSupport: "supported" }],
      workspaces: [],
    };
  }
  const hosts = [
    { serverId: "home", label: "Home" },
    { serverId: "wsl", label: "WSL" },
  ];

  test("leaves unique names alone and keeps project IDs separate from labels", () => {
    expect([...resolveSidebarProjectLabels([project("id", "PrintStream", "home")], hosts)]).toEqual(
      [["id", "PrintStream"]],
    );
  });

  test("qualifies duplicate project names with host names", () => {
    expect([
      ...resolveSidebarProjectLabels(
        [project("one", "PrintStream", "home"), project("two", "PrintStream", "wsl")],
        hosts,
      ),
    ]).toEqual([
      ["one", "PrintStream (Home)"],
      ["two", "PrintStream (WSL)"],
    ]);
  });

  test("uses paths when names also collide on the same host", () => {
    expect([
      ...resolveSidebarProjectLabels(
        [
          project("one", "PrintStream", "home", "/repo/one"),
          project("two", "PrintStream", "home", "/repo/two"),
        ],
        hosts,
      ),
    ]).toEqual([
      ["one", "PrintStream (Home) (/repo/one)"],
      ["two", "PrintStream (Home) (/repo/two)"],
    ]);
  });

  test("uses stable host identity when a host has no display name", () => {
    expect([
      ...resolveSidebarProjectLabels(
        [project("one", "PrintStream", "home"), project("two", "PrintStream", "wsl")],
        [{ serverId: "home", label: "  " }],
      ),
    ]).toEqual([
      ["one", "PrintStream (home)"],
      ["two", "PrintStream (wsl)"],
    ]);
  });
});
