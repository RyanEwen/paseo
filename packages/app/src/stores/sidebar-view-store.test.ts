import { useSidebarQuickFilterStore } from "./sidebar-quick-filter-store";
import {
  defaultSidebarModeProfiles,
  defaultSidebarLocalModeFilters,
} from "./sidebar-mode-preferences";
import { DEFAULT_CLIENT_SETTINGS } from "@/hooks/use-settings/storage";
import { setSettingsHostSelected, setSettingsEditingBlocked } from "@/settings-sync/save-handler";
import { beforeEach, describe, expect, it } from "vitest";
import type { StateStorage } from "zustand/middleware";
import {
  createSidebarViewStorage,
  createSidebarPersistStorage,
  normalizeSidebarModeState,
  sidebarPersistedState,
  initializeSidebarModePreferences,
  installSidebarPreferenceCommitter,
  reduceSidebarPreferences,
  type SidebarPreferencePatch,
  type SidebarGroupMode,
  projectSidebarMode,
  subscribeSidebarPreferenceEdits,
  hasActiveSidebarLabelFilter,
  migrateSidebarViewState,
  SIDEBAR_UNLABELLED_LABEL_KEY,
  useSidebarViewStore,
} from "./sidebar-view-store";

interface MemoryStorage extends StateStorage<Promise<void>> {
  reads: string[];
}

function createMemoryStorage(entries: Record<string, string | null>): MemoryStorage {
  const reads: string[] = [];
  return {
    reads,
    getItem: async (name) => {
      reads.push(name);
      return entries[name] ?? null;
    },
    setItem: async (name, value) => {
      entries[name] = value;
    },
    removeItem: async (name) => {
      entries[name] = null;
    },
  };
}

describe("sidebar view store", () => {
  beforeEach(() => {
    setSettingsHostSelected(false);
    setSettingsEditingBlocked(false);
    useSidebarViewStore.setState({
      modeProfiles: defaultSidebarModeProfiles(),
      localModeFilters: defaultSidebarLocalModeFilters(),
      modeProfilesInitialized: true,
      showBackground: false,
      groupMode: "project",
      workspaceSortMode: "custom",
      sortMode: "custom",
      projectVisibility: "all",
      groupEmptyProjects: true,
      emptyProjectSortMode: "custom",
      hostFilters: [],
      projectFilters: [],
      labelFilter: { labels: [] },
    });
  });

  it("keeps workspace sorting independent of project sorting and grouping", () => {
    const store = useSidebarViewStore.getState();
    store.setWorkspaceSortMode("name");
    store.setSortMode("status");
    store.setGroupMode("status");
    expect(useSidebarViewStore.getState()).toMatchObject({
      workspaceSortMode: "status",
      sortMode: "status",
    });
    store.setGroupMode("project");
    expect(useSidebarViewStore.getState()).toMatchObject({
      workspaceSortMode: "name",
      sortMode: "status",
    });
    expect(
      migrateSidebarViewState({ groupMode: "project", workspaceSortMode: "name" }),
    ).toMatchObject({ workspaceSortMode: "name" });
  });

  it("keeps empty-project sorting independent of project sorting and persists it while hidden", () => {
    const store = useSidebarViewStore.getState();
    store.setSortMode("status");
    store.setEmptyProjectSortMode("project");
    store.setGroupEmptyProjects(false);
    store.setProjectVisibility("unarchived");
    store.setGroupMode("status");
    expect(useSidebarViewStore.getState()).toMatchObject({
      sortMode: "status",
      emptyProjectSortMode: "custom",
    });
    store.setGroupMode("project");
    expect(useSidebarViewStore.getState()).toMatchObject({
      sortMode: "status",
      emptyProjectSortMode: "project",
    });
    expect(
      migrateSidebarViewState({ groupMode: "status", emptyProjectSortMode: "project" }),
    ).toMatchObject({ emptyProjectSortMode: "project" });
    expect(migrateSidebarViewState({ groupMode: "status" })).toMatchObject({
      emptyProjectSortMode: "custom",
    });
  });

  it("keeps optional empty-project grouping independent of mode, sorting and filtering", () => {
    const store = useSidebarViewStore.getState();
    store.setGroupEmptyProjects(false);
    store.setSortMode("project");
    store.setProjectVisibility("unarchived");
    store.setGroupMode("status");
    store.setGroupMode("project");
    expect(useSidebarViewStore.getState()).toMatchObject({
      groupEmptyProjects: false,
      sortMode: "project",
      projectVisibility: "unarchived",
    });
    expect(
      migrateSidebarViewState({ groupMode: "status", groupEmptyProjects: false }),
    ).toMatchObject({ groupEmptyProjects: false });
    expect(migrateSidebarViewState({ groupMode: "project" })).toMatchObject({
      groupEmptyProjects: true,
      emptyProjectSortMode: "custom",
    });
  });

  it("changes grouping without changing the selected filter or sorting", () => {
    const store = useSidebarViewStore.getState();
    store.setProjectVisibility("unarchived");
    store.setSortMode("project");
    store.setGroupMode("status");
    store.setGroupMode("project");

    expect(useSidebarViewStore.getState()).toMatchObject({
      groupMode: "project",
      projectVisibility: "unarchived",
      groupEmptyProjects: true,
      emptyProjectSortMode: "custom",
      sortMode: "project",
    });
  });

  it("keeps independent persisted preferences rather than deriving them from grouping", () => {
    expect(
      migrateSidebarViewState({
        groupMode: "status",
        projectVisibility: "all",
        groupEmptyProjects: true,
        emptyProjectSortMode: "custom",
        sortMode: "custom",
      }),
    ).toMatchObject({ groupMode: "status", projectVisibility: "all", sortMode: "custom" });
  });

  it("preserves independent sorting and filters when background visibility is added", () => {
    const preferences = {
      groupMode: "status",
      workspaceSortMode: "name",
      sortMode: "project",
      projectVisibility: "unarchived",
      groupEmptyProjects: false,
      emptyProjectSortMode: "project",
      hostFilters: ["host-a"],
      projectFilters: ["project-a"],
      labelFilter: { labels: ["review"] },
    };
    expect(migrateSidebarViewState(preferences)).toEqual({ ...preferences, showBackground: false });
    expect(migrateSidebarViewState({ ...preferences, showBackground: true })).toEqual({
      ...preferences,
      showBackground: true,
    });
  });

  it("preserves the previous status view when adding independent preferences", () => {
    expect(migrateSidebarViewState({ groupMode: "status" })).toMatchObject({
      groupMode: "status",
      projectVisibility: "unarchived",
      groupEmptyProjects: true,
      emptyProjectSortMode: "custom",
      sortMode: "status",
    });
  });

  it("toggles multiple hosts into and out of the filter", () => {
    const store = useSidebarViewStore.getState();
    store.toggleHostFilter("host-a");
    store.toggleHostFilter("host-b");

    expect(useSidebarViewStore.getState().hostFilters).toEqual(["host-a", "host-b"]);

    store.toggleHostFilter("host-a");

    expect(useSidebarViewStore.getState().hostFilters).toEqual(["host-b"]);

    store.clearHostFilters();

    expect(useSidebarViewStore.getState().hostFilters).toEqual([]);
  });

  it("keeps host filters that still point at available hosts", () => {
    const store = useSidebarViewStore.getState();
    store.toggleHostFilter("host-a");
    store.toggleHostFilter("host-b");

    store.reconcileHostFilters(["host-a", "host-b", "host-c"]);

    expect(useSidebarViewStore.getState().hostFilters).toEqual(["host-a", "host-b"]);
  });

  it("drops a host filter after that host is removed", () => {
    const store = useSidebarViewStore.getState();
    store.toggleHostFilter("host-a");
    store.toggleHostFilter("removed-host");

    store.reconcileHostFilters(["host-a"]);

    expect(useSidebarViewStore.getState().hostFilters).toEqual(["host-a"]);
  });

  it("migrates legacy per-host group modes to the new global mode", () => {
    expect(
      migrateSidebarViewState({
        groupModeByServerId: {
          "host-a": "project",
          "host-b": "status",
        },
      }),
    ).toEqual({
      showBackground: false,
      groupMode: "status",
      workspaceSortMode: "status",
      sortMode: "status",
      projectVisibility: "unarchived",
      groupEmptyProjects: true,
      emptyProjectSortMode: "custom",
      hostFilters: [],
      projectFilters: [],
      labelFilter: { labels: [] },
    });
  });

  it("migrates a pre-v2 single host filter to the multi-host list", () => {
    expect(
      migrateSidebarViewState({
        groupMode: "status",
        sortMode: "status",
        projectVisibility: "unarchived",
        groupEmptyProjects: true,
        emptyProjectSortMode: "custom",
        hostFilter: "host-a",
      }),
    ).toEqual({
      showBackground: false,
      groupMode: "status",
      workspaceSortMode: "status",
      sortMode: "status",
      projectVisibility: "unarchived",
      groupEmptyProjects: true,
      emptyProjectSortMode: "custom",
      hostFilters: ["host-a"],
      projectFilters: [],
      labelFilter: { labels: [] },
    });
  });

  it("keeps current persisted sidebar view state during version migration", () => {
    expect(
      migrateSidebarViewState({
        groupMode: "status",
        sortMode: "status",
        projectVisibility: "unarchived",
        groupEmptyProjects: true,
        emptyProjectSortMode: "custom",
        hostFilters: ["host-a", "host-b"],
      }),
    ).toEqual({
      showBackground: false,
      groupMode: "status",
      workspaceSortMode: "status",
      sortMode: "status",
      projectVisibility: "unarchived",
      groupEmptyProjects: true,
      emptyProjectSortMode: "custom",
      hostFilters: ["host-a", "host-b"],
      projectFilters: [],
      labelFilter: { labels: [] },
    });
  });

  it("clears only the label facet", () => {
    useSidebarViewStore.setState({
      ...normalizeSidebarModeState({
        groupMode: "status",
        sortMode: "status",
        projectVisibility: "unarchived",
        groupEmptyProjects: true,
        emptyProjectSortMode: "custom",
        hostFilters: ["host-a"],
        labelFilter: { labels: ["urgent", "blocked"] },
      }),
      modeProfilesInitialized: true,
    });

    useSidebarViewStore.getState().clearLabelFilter();

    expect(useSidebarViewStore.getState()).toMatchObject({
      groupMode: "status",
      sortMode: "status",
      projectVisibility: "unarchived",
      groupEmptyProjects: true,
      emptyProjectSortMode: "custom",
      hostFilters: ["host-a"],
      labelFilter: { labels: [] },
    });
  });

  it("toggles a label on and off under one normalized identity", () => {
    const { toggleLabelFilter } = useSidebarViewStore.getState();
    const labels = () => useSidebarViewStore.getState().labelFilter.labels;

    toggleLabelFilter("Urgent");
    expect(labels()).toEqual(["urgent"]);
    expect(hasActiveSidebarLabelFilter(useSidebarViewStore.getState().labelFilter)).toBe(true);

    toggleLabelFilter(" URGENT ");
    expect(labels()).toEqual([]);
    expect(hasActiveSidebarLabelFilter(useSidebarViewStore.getState().labelFilter)).toBe(false);
  });

  it("filters Unlabelled alongside real labels without colliding with one", () => {
    const { toggleLabelFilter } = useSidebarViewStore.getState();

    toggleLabelFilter(SIDEBAR_UNLABELLED_LABEL_KEY);
    toggleLabelFilter("Urgent");
    expect(useSidebarViewStore.getState().labelFilter).toEqual({
      labels: [SIDEBAR_UNLABELLED_LABEL_KEY, "urgent"],
    });
  });

  it("drops deleted labels from the active filter but retains Unlabelled", () => {
    useSidebarViewStore.setState({
      labelFilter: { labels: [SIDEBAR_UNLABELLED_LABEL_KEY, "urgent", "removed"] },
    });

    useSidebarViewStore.getState().reconcileLabelFilter(["Urgent"]);

    expect(useSidebarViewStore.getState().labelFilter).toEqual({
      labels: [SIDEBAR_UNLABELLED_LABEL_KEY, "urgent"],
    });
  });

  it("re-keys a persisted label filter through the normalized identity, without duplicates", () => {
    expect(
      migrateSidebarViewState({
        labelFilter: { labels: [" Urgent ", "BLOCKED", "urgent"], match: "all" },
      }).labelFilter,
    ).toEqual({ labels: ["urgent", "blocked"] });
  });

  it("selects one project explicitly, replacing saved multi-project and unavailable choices", () => {
    useSidebarViewStore.setState({ projectFilters: ["project-a", "project-b", "offline-project"] });
    useSidebarViewStore.getState().selectProjectFilter("project-b");
    expect(useSidebarViewStore.getState().projectFilters).toEqual(["project-b"]);
    useSidebarViewStore.getState().toggleProjectFilter("project-a");
    expect(useSidebarViewStore.getState().projectFilters).toEqual(["project-b", "project-a"]);
  });

  it("toggles multiple projects into and out of the filter", () => {
    const store = useSidebarViewStore.getState();
    store.toggleProjectFilter("project-a");
    store.toggleProjectFilter("project-b");

    expect(useSidebarViewStore.getState().projectFilters).toEqual(["project-a", "project-b"]);

    store.toggleProjectFilter("project-a");

    expect(useSidebarViewStore.getState().projectFilters).toEqual(["project-b"]);

    store.clearProjectFilters();

    expect(useSidebarViewStore.getState().projectFilters).toEqual([]);
  });

  it("keeps the other facets when the project filter is cleared", () => {
    useSidebarViewStore.setState({
      ...normalizeSidebarModeState({
        groupMode: "status",
        sortMode: "status",
        projectVisibility: "unarchived",
        groupEmptyProjects: true,
        emptyProjectSortMode: "custom",
        hostFilters: ["host-a"],
        projectFilters: ["project-a"],
        labelFilter: { labels: ["urgent"] },
      }),
      modeProfilesInitialized: true,
    });

    useSidebarViewStore.getState().clearProjectFilters();

    expect(useSidebarViewStore.getState()).toMatchObject({
      groupMode: "status",
      sortMode: "status",
      projectVisibility: "unarchived",
      groupEmptyProjects: true,
      emptyProjectSortMode: "custom",
      hostFilters: ["host-a"],
      projectFilters: [],
      labelFilter: { labels: ["urgent"] },
    });
  });

  // The persisted schema is a `z.strictObject` behind `createValidatedPersistStorage`, so a key
  // the schema does not list fails the parse and takes every other sidebar setting down with it.
  it("carries a persisted project filter through the version migration", () => {
    expect(
      migrateSidebarViewState({
        groupMode: "project",
        sortMode: "custom",
        projectVisibility: "all",
        groupEmptyProjects: true,
        emptyProjectSortMode: "custom",
        hostFilters: ["host-a"],
        projectFilters: ["project-a", "project-b"],
      }),
    ).toEqual({
      showBackground: false,
      groupMode: "project",
      workspaceSortMode: "custom",
      sortMode: "custom",
      projectVisibility: "all",
      groupEmptyProjects: true,
      emptyProjectSortMode: "custom",
      hostFilters: ["host-a"],
      projectFilters: ["project-a", "project-b"],
      labelFilter: { labels: [] },
    });
  });

  it("never keeps project filters from state the schema rejects", () => {
    expect(migrateSidebarViewState({ projectFilters: "project-a" })).toEqual({
      showBackground: false,
      groupMode: "project",
      workspaceSortMode: "custom",
      sortMode: "custom",
      projectVisibility: "all",
      groupEmptyProjects: true,
      emptyProjectSortMode: "custom",
      hostFilters: [],
      projectFilters: [],
      labelFilter: { labels: [] },
    });
  });

  it("falls back to the legacy storage key when the new key is empty", async () => {
    const storage = createMemoryStorage({
      "sidebar-view": null,
      "sidebar-group-mode": JSON.stringify({
        state: { groupModeByServerId: { "host-a": "status" } },
        version: 0,
      }),
    });

    const value = await createSidebarViewStorage(storage).getItem("sidebar-view");

    expect(value).toBe(
      JSON.stringify({
        state: { groupModeByServerId: { "host-a": "status" } },
        version: 0,
      }),
    );
    expect(storage.reads).toEqual(["sidebar-view", "sidebar-group-mode"]);
  });

  it("uses the new storage key without reading the legacy key when current state exists", async () => {
    const storage = createMemoryStorage({
      "sidebar-view": JSON.stringify({
        state: { groupMode: "project", hostFilters: ["host-a"] },
        version: 2,
      }),
      "sidebar-group-mode": JSON.stringify({
        state: { groupModeByServerId: { "host-b": "status" } },
        version: 0,
      }),
    });

    const value = await createSidebarViewStorage(storage).getItem("sidebar-view");

    expect(value).toBe(
      JSON.stringify({
        state: { groupMode: "project", hostFilters: ["host-a"] },
        version: 2,
      }),
    );
    expect(storage.reads).toEqual(["sidebar-view"]);
  });
});

it("only emits intentional general preferences, never projection or local identity filters", () => {
  const changes: unknown[] = [];
  const stop = subscribeSidebarPreferenceEdits((next) => changes.push(next.groupMode));
  try {
    useSidebarViewStore.setState({ groupMode: "status" });
    useSidebarViewStore.getState().toggleHostFilter("hostA");
    useSidebarViewStore.getState().toggleProjectFilter("projectA");
    useSidebarViewStore.getState().reconcileLabelFilter([]);
    expect(changes).toEqual([]);
    useSidebarViewStore.getState().setGroupMode("project");
    expect(changes).toEqual(["project"]);
    setSettingsEditingBlocked(true);
    useSidebarViewStore.getState().setGroupMode("status");
    expect(changes).toEqual(["project"]);
    expect(useSidebarViewStore.getState().groupMode).toBe("project");
  } finally {
    stop();
    setSettingsEditingBlocked(false);
  }
});

it("retains synced label choices when another client's available labels differ", () => {
  setSettingsHostSelected(true);
  try {
    useSidebarViewStore.setState({ labelFilter: { labels: ["remote-label"] } });
    useSidebarViewStore.getState().reconcileLabelFilter(["local-label"]);
    expect(useSidebarViewStore.getState().labelFilter.labels).toEqual(["remote-label"]);
  } finally {
    setSettingsHostSelected(false);
  }
});

describe("separate sidebar modes", () => {
  it("atomically restores independent local facets, presentation and count/age preferences", () => {
    const modeProfiles = defaultSidebarModeProfiles();
    const localModeFilters = defaultSidebarLocalModeFilters();
    useSidebarViewStore.setState({
      ...projectSidebarMode({ groupMode: "project", modeProfiles, localModeFilters }),
      modeProfilesInitialized: true,
    });
    const store = useSidebarViewStore.getState();
    store.setModePreferences({
      workspaceTitleSource: "branch",
      initialWorkspaceCount: 5,
      workspaceUpdatedWithinDays: 3,
    });
    store.toggleHostFilter("offline-host");
    store.toggleProjectFilter("opaque-project");
    store.toggleLabelFilter("urgent");
    const observed: unknown[] = [];
    const stop = useSidebarViewStore.subscribe((state) =>
      observed.push([state.groupMode, state.initialWorkspaceCount, state.hostFilters]),
    );
    store.setGroupMode("status");
    stop();
    expect(observed).toEqual([["status", 20, []]]);
    store.setModePreferences({ initialWorkspaceCount: null, workspaceUpdatedWithinDays: 14 });
    store.toggleHostFilter("status-host");
    store.setGroupMode("project");
    expect(useSidebarViewStore.getState()).toMatchObject({
      workspaceTitleSource: "branch",
      initialWorkspaceCount: 5,
      workspaceUpdatedWithinDays: 3,
      hostFilters: ["offline-host"],
      projectFilters: ["opaque-project"],
      labelFilter: { labels: ["urgent"] },
    });
    store.setGroupMode("status");
    expect(useSidebarViewStore.getState()).toMatchObject({
      initialWorkspaceCount: null,
      workspaceUpdatedWithinDays: 14,
      hostFilters: ["status-host"],
      projectFilters: [],
    });
  });
  it("migrates only the active mode once after the legacy app preferences are available", () => {
    useSidebarViewStore.setState(
      normalizeSidebarModeState({
        groupMode: "status",
        workspaceSortMode: "name",
        hostFilters: ["host"],
      }),
    );
    initializeSidebarModePreferences({
      ...DEFAULT_CLIENT_SETTINGS,
      sidebarInitialWorkspaceCount: 37,
      workspaceTitleSource: "branch",
    });
    expect(useSidebarViewStore.getState().modeProfiles.status).toMatchObject({
      initialWorkspaceCount: 37,
      workspaceTitleSource: "branch",
      workspaceSortMode: "name",
    });
    expect(useSidebarViewStore.getState().modeProfiles.project).toMatchObject({
      initialWorkspaceCount: 20,
      workspaceTitleSource: "title",
      workspaceSortMode: "custom",
    });
    initializeSidebarModePreferences(DEFAULT_CLIENT_SETTINGS);
    expect(useSidebarViewStore.getState().initialWorkspaceCount).toBe(37);
    const saved = normalizeSidebarModeState({
      groupMode: "status",
      modeProfiles: useSidebarViewStore.getState().modeProfiles,
      localModeFilters: useSidebarViewStore.getState().localModeFilters,
      sortMode: "project",
    });
    expect(saved.initialWorkspaceCount).toBe(37);
    expect(saved.localModeFilters.status.hostFilters).toEqual(["host"]);
    expect(saved.localModeFilters.project.hostFilters).toEqual([]);
  });
});

it("hydrates a real version-11 envelope once and preserves the intermediate restart before app settings arrive", async () => {
  const initial = {
    groupMode: "status",
    sortMode: "project",
    workspaceSortMode: "name",
    hostFilters: ["offline"],
    projectFilters: ["opaque"],
    labelFilter: { labels: ["urgent"] },
  };
  const entries: Record<string, string | null> = {
    "sidebar-view": JSON.stringify({ version: 11, state: initial }),
  };
  const storage = createMemoryStorage(entries);
  const original = useSidebarViewStore.persist.getOptions().storage;
  useSidebarViewStore.persist.setOptions({ storage: createSidebarPersistStorage(storage) });
  try {
    await useSidebarViewStore.persist.rehydrate();
    expect(useSidebarViewStore.getState()).toMatchObject({
      ...initial,
      modeProfilesInitialized: false,
    });
    useSidebarViewStore.getState().setSortMode("status");
    expect(useSidebarViewStore.getState().sortMode).toBe("project");
    const intermediate = entries["sidebar-view"]!;
    expect(JSON.parse(intermediate)).toMatchObject({
      version: 12,
      state: {
        groupMode: "status",
        localModeFilters: { status: { hostFilters: ["offline"], projectFilters: ["opaque"] } },
      },
    });
    expect(JSON.parse(intermediate).state.modeProfiles).toBeUndefined();
    await useSidebarViewStore.persist.rehydrate();
    expect(useSidebarViewStore.getState()).toMatchObject({
      ...initial,
      modeProfilesInitialized: false,
    });
    initializeSidebarModePreferences({
      ...DEFAULT_CLIENT_SETTINGS,
      sidebarInitialWorkspaceCount: 37,
      workspaceTitleSource: "branch",
    });
    expect(useSidebarViewStore.getState().modeProfiles.status).toMatchObject({
      sortMode: "project",
      workspaceSortMode: "name",
      initialWorkspaceCount: 37,
      workspaceTitleSource: "branch",
    });
    expect(useSidebarViewStore.getState().modeProfiles.project).toMatchObject({
      sortMode: "custom",
      initialWorkspaceCount: 20,
      workspaceTitleSource: "title",
    });
    await useSidebarViewStore.persist.rehydrate();
    initializeSidebarModePreferences(DEFAULT_CLIENT_SETTINGS);
    expect(useSidebarViewStore.getState()).toMatchObject({
      groupMode: "status",
      initialWorkspaceCount: 37,
      hostFilters: ["offline"],
      projectFilters: ["opaque"],
    });
  } finally {
    useSidebarViewStore.persist.setOptions({ storage: original });
  }
});

it("does not bypass a selected settings authority while its command owner is unavailable", () => {
  const before = useSidebarViewStore.getState().groupMode;
  setSettingsHostSelected(true);
  try {
    useSidebarViewStore.getState().setGroupMode(before === "project" ? "status" : "project");
    expect(useSidebarViewStore.getState().groupMode).toBe(before);
    expect(useSidebarViewStore.getState().preferenceError).toBe(
      "Settings synchronization is unavailable",
    );
  } finally {
    setSettingsHostSelected(false);
  }
});

it("retains both queued empty-project toggles on the captured mode after the visible mode changes", async () => {
  useSidebarViewStore.setState({
    ...projectSidebarMode({
      groupMode: "project",
      modeProfiles: defaultSidebarModeProfiles(),
      localModeFilters: defaultSidebarLocalModeFilters(),
    }),
    modeProfilesInitialized: true,
  });
  const pending: Array<{ patch: SidebarPreferencePatch; mode: SidebarGroupMode; resolve(): void }> =
    [];
  const uninstall = installSidebarPreferenceCommitter(
    (patch, mode) =>
      new Promise<void>((resolve) => {
        pending.push({ patch, mode, resolve });
      }),
  );
  try {
    const toggle = useSidebarViewStore.getState().toggleModeEmptyProjects;
    toggle("project");
    toggle("project");
    expect(pending).toHaveLength(2);
    useSidebarViewStore.setState(
      projectSidebarMode({ ...useSidebarViewStore.getState(), groupMode: "status" }),
    );
    const values: boolean[] = [];
    for (const command of pending) {
      useSidebarViewStore.setState(
        reduceSidebarPreferences(useSidebarViewStore.getState(), command.patch, command.mode),
      );
      values.push(useSidebarViewStore.getState().modeProfiles.project.groupEmptyProjects);
      command.resolve();
      await Promise.resolve();
    }
    expect(values).toEqual([false, true]);
    expect(useSidebarViewStore.getState()).toMatchObject({
      groupMode: "status",
      groupEmptyProjects: true,
      preferencePendingCount: 0,
    });
    expect(useSidebarViewStore.getState().modeProfiles.status.groupEmptyProjects).toBe(true);
  } finally {
    uninstall();
  }
});

it("defaults the new profile leaf off in existing profiles and persists it independently by mode", async () => {
  setSettingsHostSelected(false);
  setSettingsEditingBlocked(false);
  const profiles = defaultSidebarModeProfiles();
  const { oneProjectAtATime: _project, ...oldProject } = profiles.project;
  const { oneProjectAtATime: _status, ...oldStatus } = profiles.status;
  const migrated = normalizeSidebarModeState({
    groupMode: "project",
    modeProfiles: { project: oldProject, status: oldStatus },
  });
  expect(migrated.modeProfiles.project.oneProjectAtATime).toBe(false);
  expect(migrated.modeProfiles.status.oneProjectAtATime).toBe(false);
  useSidebarViewStore.setState({ ...migrated, modeProfilesInitialized: true });
  useSidebarViewStore.getState().setModePreferences({ oneProjectAtATime: true }, "project");
  useSidebarViewStore.getState().setGroupMode("status");
  expect(useSidebarViewStore.getState().oneProjectAtATime).toBe(false);
  const storage = createSidebarPersistStorage(createMemoryStorage({}));
  const state = useSidebarViewStore.getState();
  const persisted = {
    groupMode: state.groupMode,
    modeProfiles: state.modeProfiles,
    localModeFilters: state.localModeFilters,
  };
  await storage.setItem("sidebar-view", { state: persisted, version: 12 });
  const restored = await storage.getItem("sidebar-view");
  expect(normalizeSidebarModeState(restored?.state).modeProfiles).toMatchObject({
    project: { oneProjectAtATime: true },
    status: { oneProjectAtATime: false },
  });
});

it("serializes rapid functional accordion toggles against the rendered project profile", async () => {
  setSettingsHostSelected(false);
  setSettingsEditingBlocked(false);
  useSidebarViewStore.setState({
    ...projectSidebarMode({
      groupMode: "project",
      modeProfiles: defaultSidebarModeProfiles(),
      localModeFilters: defaultSidebarLocalModeFilters(),
    }),
    modeProfilesInitialized: true,
  });
  const pending: Array<{ patch: SidebarPreferencePatch; mode: SidebarGroupMode; resolve(): void }> =
    [];
  const uninstall = installSidebarPreferenceCommitter(
    (patch, mode) =>
      new Promise<void>((resolve) => {
        pending.push({ patch, mode, resolve });
      }),
  );
  try {
    const commit = useSidebarViewStore.getState().setModePreferences;
    commit((current) => ({ oneProjectAtATime: !current.oneProjectAtATime }), "project");
    commit((current) => ({ oneProjectAtATime: !current.oneProjectAtATime }), "project");
    useSidebarViewStore.setState(
      projectSidebarMode({ ...useSidebarViewStore.getState(), groupMode: "status" }),
    );
    const observed: boolean[] = [];
    for (const command of pending) {
      useSidebarViewStore.setState(
        reduceSidebarPreferences(useSidebarViewStore.getState(), command.patch, command.mode),
      );
      observed.push(useSidebarViewStore.getState().modeProfiles.project.oneProjectAtATime);
      command.resolve();
      await Promise.resolve();
    }
    expect(observed).toEqual([true, false]);
    expect(useSidebarViewStore.getState()).toMatchObject({
      groupMode: "status",
      oneProjectAtATime: false,
    });
    expect(useSidebarViewStore.getState().modeProfiles.status.oneProjectAtATime).toBe(false);
  } finally {
    uninstall();
  }
});

it("keeps quick text per mode, local and transient even while settings editing is blocked", () => {
  const store = useSidebarQuickFilterStore.getState();
  store.close("project");
  store.close("status");
  const before = useSidebarViewStore.getState();
  const edits: unknown[] = [];
  const unsubscribe = subscribeSidebarPreferenceEdits((next) => edits.push(next));
  setSettingsEditingBlocked(true);
  try {
    store.toggle("project");
    store.setText("project", "session-only-needle");
    store.toggle("status");
    store.setText("status", "another needle");
    const current = useSidebarQuickFilterStore.getState();
    expect(current.byMode).toEqual({
      project: { open: true, text: "session-only-needle" },
      status: { open: true, text: "another needle" },
    });
    expect(useSidebarViewStore.getState().modeProfiles).toBe(before.modeProfiles);
    expect(useSidebarViewStore.getState().localModeFilters).toBe(before.localModeFilters);
    expect(edits).toEqual([]);
    expect(useSidebarQuickFilterStore).not.toHaveProperty("persist");
    expect(sidebarPersistedState(useSidebarViewStore.getState())).not.toHaveProperty(
      "quickFilterByMode",
    );
    expect(JSON.stringify(sidebarPersistedState(useSidebarViewStore.getState()))).not.toContain(
      "session-only-needle",
    );
    store.close("project");
    store.setText("project", "late native event");
    expect(useSidebarQuickFilterStore.getState().byMode.project).toEqual({ open: false, text: "" });
    expect(useSidebarQuickFilterStore.getState().byMode.status.text).toBe("another needle");
  } finally {
    unsubscribe();
    setSettingsEditingBlocked(false);
    store.close("project");
    store.close("status");
  }
});
