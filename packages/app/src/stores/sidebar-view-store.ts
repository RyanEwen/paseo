import {
  SidebarModePreferencesSchema,
  SidebarModeProfilesSchema,
  SidebarLocalModeFiltersSchema,
  defaultSidebarModeProfiles,
  defaultSidebarLocalModeFilters,
  legacySidebarPresentation,
  type SidebarModePreferences,
  type SidebarModeProfiles,
  type SidebarLocalModeFilters,
} from "./sidebar-mode-preferences";
import type { AppSettings } from "@/hooks/use-settings/storage";
import { getSettingsHostSelected, getSettingsEditingBlocked } from "@/settings-sync/save-handler";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist, type StateStorage } from "zustand/middleware";
import { z } from "zod";
import { workspaceLabelKey } from "@getpaseo/protocol/workspace-labels";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

export type SidebarGroupMode = "project" | "status";
export type SidebarWorkspaceSortMode = "name" | "status" | "custom";
export type SidebarSortMode = "project" | "status" | "custom";
export type SidebarEmptyProjectSortMode = "project" | "custom";
export type SidebarProjectVisibility = "all" | "unarchived";

const SIDEBAR_VIEW_STORAGE_KEY = "sidebar-view";
const LEGACY_SIDEBAR_GROUP_MODE_STORAGE_KEY = "sidebar-group-mode";
const SIDEBAR_VIEW_STORE_VERSION = 12;

/**
 * The key standing for "this workspace carries no labels at all".
 *
 * `normalizeWorkspaceLabelName` trims, so no real label can ever normalize to the empty string
 * and nothing in `labels` can collide with it. That is the whole reason the empty string is the
 * choice: a sentinel like `"__unlabelled__"` would be a name a person is free to type.
 */
export const SIDEBAR_UNLABELLED_LABEL_KEY = "";

/**
 * What the sidebar's Labels page currently says.
 *
 * The labels pinned to, keyed by `workspaceLabelKey`, exactly as `hostFilters` holds server ids:
 * empty means "every label", non-empty includes workspaces carrying any selected label.
 */
export interface SidebarLabelFilter {
  labels: string[];
}

export function hasActiveSidebarLabelFilter(filter: SidebarLabelFilter): boolean {
  return filter.labels.length > 0;
}

/**
 * Include/exclude toggle over an allowlist, shared by the host and project filters.
 *
 * Both filters answer the same question — "is this one of the things I pinned the sidebar to" —
 * so they share the operation. The label filter does not: its keys go through
 * `workspaceLabelKey` first, which is a different identity.
 */
function toggleFilterEntry(list: readonly string[], key: string): string[] {
  return list.includes(key) ? list.filter((entry) => entry !== key) : [...list, key];
}

export interface SidebarViewStoreState extends SidebarModePreferences {
  modeProfiles: SidebarModeProfiles;
  localModeFilters: SidebarLocalModeFilters;
  modeProfilesInitialized: boolean;
  preferenceError: string | null;
  preferencePendingCount: number;
  setModePreferences: (
    patch:
      | Partial<SidebarModePreferences>
      | ((profile: SidebarModePreferences) => Partial<SidebarModePreferences>),
    mode?: SidebarGroupMode,
  ) => void;
  updateLocalFilters: (
    update: (
      current: SidebarLocalModeFilters[SidebarGroupMode],
    ) => SidebarLocalModeFilters[SidebarGroupMode],
  ) => void;
  groupMode: SidebarGroupMode;
  sortMode: SidebarSortMode;
  workspaceSortMode: SidebarWorkspaceSortMode;
  projectVisibility: SidebarProjectVisibility;
  groupEmptyProjects: boolean;
  emptyProjectSortMode: SidebarEmptyProjectSortMode;
  showBackground: boolean;
  // Empty means "all hosts". A non-empty list pins the sidebar to those hosts.
  hostFilters: string[];
  /**
   * Empty means "all projects". A non-empty list is an allowlist over
   * `SidebarProjectEntry.viewKey` — the same key the project sections are built from.
   *
   * There is deliberately no `reconcileProjectFilters` counterpart to `reconcileHostFilters`.
   * The project list is narrowed by the host filter and is empty before any host connects, so
   * reconciling against it would silently destroy the filter on every cold start and every
   * host-filter change. Stale keys are resolved away at read time instead — see
   * `resolveActiveProjectFilters`.
   */
  projectFilters: string[];
  labelFilter: SidebarLabelFilter;
  setEmptyProjectSortMode: (mode: SidebarEmptyProjectSortMode) => void;
  setGroupEmptyProjects: (enabled: boolean) => void;
  toggleModeEmptyProjects: (mode?: SidebarGroupMode) => void;
  toggleBackground: () => void;
  setGroupMode: (mode: SidebarGroupMode) => void;
  toggleGroupMode: () => void;
  setWorkspaceSortMode: (mode: SidebarWorkspaceSortMode) => void;
  setSortMode: (mode: SidebarSortMode) => void;
  setProjectVisibility: (visibility: SidebarProjectVisibility) => void;
  toggleHostFilter: (serverId: string) => void;
  clearHostFilters: () => void;
  /** Explicitly choose one project, replacing previous choices including unavailable keys. */
  selectProjectFilter: (viewKey: string) => void;
  toggleProjectFilter: (viewKey: string) => void;
  clearProjectFilters: () => void;
  toggleLabelFilter: (name: string) => void;
  clearLabelFilter: () => void;
  reconcileLabelFilter: (labels: readonly string[]) => void;
  reconcileHostFilters: (serverIds: readonly string[]) => void;
}

interface SidebarViewPersistedState {
  groupMode: SidebarGroupMode;
  sortMode: SidebarSortMode;
  workspaceSortMode: SidebarWorkspaceSortMode;
  projectVisibility: SidebarProjectVisibility;
  groupEmptyProjects: boolean;
  emptyProjectSortMode: SidebarEmptyProjectSortMode;
  showBackground: boolean;
  hostFilters: string[];
  projectFilters: string[];
  labelFilter: SidebarLabelFilter;
}

const PersistedSidebarGroupModeSchema = z.enum(["project", "status", "label"]);
const SidebarLabelFilterSchema = z.object({
  labels: z.array(z.string()),
});
const SidebarViewPersistedStateSchema = z.strictObject({
  modeProfiles: SidebarModeProfilesSchema.optional(),
  localModeFilters: SidebarLocalModeFiltersSchema.optional(),
  showBackground: z.boolean().optional(),
  groupMode: PersistedSidebarGroupModeSchema.optional(),
  workspaceSortMode: z.enum(["name", "status", "custom"]).optional(),
  sortMode: z.enum(["project", "status", "custom"]).optional(),
  projectVisibility: z.enum(["all", "unarchived"]).optional(),
  groupEmptyProjects: z.boolean().optional(),
  emptyProjectSortMode: z.enum(["project", "custom"]).optional(),
  hostFilters: z.array(z.string()).optional(),
  hostFilter: z.string().nullable().optional(),
  projectFilters: z.array(z.string()).optional(),
  groupModeByServerId: z.record(z.string(), PersistedSidebarGroupModeSchema).optional(),
  labelFilter: SidebarLabelFilterSchema.optional(),
});

type SidebarViewStorageState = z.infer<typeof SidebarViewPersistedStateSchema>;

function readLegacyGroupMode(persistedState: SidebarViewStorageState): SidebarGroupMode | null {
  const groupModeByServerId = persistedState.groupModeByServerId;
  if (!groupModeByServerId) {
    return null;
  }

  const modes = Object.values(groupModeByServerId);
  if (modes.length === 0) return null;
  return modes.includes("status") ? "status" : "project";
}

// Reads the host filter from any persisted shape: the current `hostFilters` array, or the
// pre-v2 single `hostFilter` string (null/absent meant "all hosts").
function readHostFilters(persistedState: SidebarViewStorageState): string[] {
  const hostFilters = persistedState.hostFilters;
  if (hostFilters) {
    return hostFilters;
  }
  // COMPAT(sidebarHostFilters): added in v0.1.102, remove after 2026-12-30 once pre-v2 persisted
  // sidebar state (a single `hostFilter` string) has aged out.
  const legacyHostFilter = persistedState.hostFilter;
  return legacyHostFilter ? [legacyHostFilter] : [];
}

export function migrateSidebarViewState(persistedState: unknown): SidebarViewPersistedState {
  const result = SidebarViewPersistedStateSchema.safeParse(persistedState);
  if (!result.success) {
    return {
      showBackground: false,
      groupMode: "project",
      sortMode: "custom",
      workspaceSortMode: "custom",
      projectVisibility: "all",
      groupEmptyProjects: true,
      emptyProjectSortMode: "custom",
      hostFilters: [],
      projectFilters: [],
      labelFilter: emptyLabelFilter(),
    };
  }
  const state = result.data;

  const legacyGroupMode = readLegacyGroupMode(state);
  if (legacyGroupMode) {
    return {
      showBackground: false,
      groupMode: legacyGroupMode,
      workspaceSortMode: legacyGroupMode === "status" ? "status" : "custom",
      sortMode: legacyGroupMode === "status" ? "status" : "custom",
      projectVisibility: legacyGroupMode === "status" ? "unarchived" : "all",
      groupEmptyProjects: true,
      emptyProjectSortMode: "custom",
      hostFilters: [],
      projectFilters: [],
      labelFilter: emptyLabelFilter(),
    };
  }

  return {
    showBackground: state.showBackground ?? false,
    groupMode: state.groupMode === "status" ? "status" : "project",
    // Preserve the old view once; subsequent grouping changes leave both choices alone.
    workspaceSortMode:
      state.workspaceSortMode ?? (state.groupMode === "status" ? "status" : "custom"),
    sortMode: state.sortMode ?? (state.groupMode === "status" ? "status" : "custom"),
    projectVisibility:
      state.projectVisibility ?? (state.groupMode === "status" ? "unarchived" : "all"),
    groupEmptyProjects: state.groupEmptyProjects ?? true,
    emptyProjectSortMode: state.emptyProjectSortMode ?? "custom",
    hostFilters: readHostFilters(state),
    projectFilters: state.projectFilters ?? [],
    labelFilter: state.labelFilter
      ? normalizeSidebarLabelFilter(state.labelFilter)
      : emptyLabelFilter(),
  };
}

export function projectSidebarMode(state: {
  groupMode: SidebarGroupMode;
  modeProfiles: SidebarModeProfiles;
  localModeFilters: SidebarLocalModeFilters;
}) {
  return {
    ...state,
    ...state.modeProfiles[state.groupMode],
    ...state.localModeFilters[state.groupMode],
  };
}

export function normalizeSidebarModeState(persistedState: unknown) {
  const legacy = migrateSidebarViewState(persistedState);
  const parsed = SidebarViewPersistedStateSchema.safeParse(persistedState);
  const profiles = parsed.success ? parsed.data.modeProfiles : undefined;
  const modeProfiles = profiles ?? defaultSidebarModeProfiles();
  const localModeFilters =
    parsed.success && parsed.data.localModeFilters
      ? parsed.data.localModeFilters
      : defaultSidebarLocalModeFilters();
  if (!profiles) {
    const { hostFilters, projectFilters, groupMode, ...preferences } = legacy;
    modeProfiles[groupMode] = { ...modeProfiles[groupMode], ...preferences };
    if (!(parsed.success && parsed.data.localModeFilters))
      localModeFilters[groupMode] = { hostFilters, projectFilters };
  }
  return {
    ...projectSidebarMode({ groupMode: legacy.groupMode, modeProfiles, localModeFilters }),
    modeProfilesInitialized: !!profiles,
  };
}

export function sidebarPersistedState(
  state: Pick<
    SidebarViewStoreState,
    "groupMode" | "modeProfiles" | "modeProfilesInitialized" | "localModeFilters"
  >,
) {
  return {
    groupMode: state.groupMode,
    ...(state.modeProfilesInitialized
      ? { modeProfiles: state.modeProfiles }
      : {
          sortMode: state.modeProfiles[state.groupMode].sortMode,
          workspaceSortMode: state.modeProfiles[state.groupMode].workspaceSortMode,
          projectVisibility: state.modeProfiles[state.groupMode].projectVisibility,
          groupEmptyProjects: state.modeProfiles[state.groupMode].groupEmptyProjects,
          emptyProjectSortMode: state.modeProfiles[state.groupMode].emptyProjectSortMode,
          showBackground: state.modeProfiles[state.groupMode].showBackground,
          labelFilter: state.modeProfiles[state.groupMode].labelFilter,
        }),
    localModeFilters: state.localModeFilters,
  };
}
export function migrateSidebarPersistedState(value: unknown) {
  const state = normalizeSidebarModeState(value);
  // Before AppSettings import, only the legacy sidebar leaves belong in this envelope.
  if (state.modeProfilesInitialized) return sidebarPersistedState(state);
  const legacy = migrateSidebarViewState(value);
  const { hostFilters: _hosts, projectFilters: _projects, ...preferences } = legacy;
  return { ...preferences, localModeFilters: state.localModeFilters };
}

/** Called only after both persistence owners have hydrated, before admitting preference edits. */
export function initializeSidebarModePreferences(settings: AppSettings): void {
  const current = useSidebarViewStore.getState();
  if (current.modeProfilesInitialized) return;
  const modeProfiles = {
    ...current.modeProfiles,
    [current.groupMode]: {
      ...current.modeProfiles[current.groupMode],
      ...legacySidebarPresentation(settings),
    },
  };
  useSidebarViewStore.setState({
    ...projectSidebarMode({ ...current, modeProfiles }),
    modeProfilesInitialized: true,
  });
}

export type SidebarPreferencePatch =
  | Partial<SidebarViewStoreState>
  | ((state: SidebarViewStoreState) => Partial<SidebarViewStoreState>);
let preferenceCommitter:
  | ((patch: SidebarPreferencePatch, targetMode: SidebarGroupMode) => Promise<void>)
  | null = null;
export function installSidebarPreferenceCommitter(commit: NonNullable<typeof preferenceCommitter>) {
  preferenceCommitter = commit;
  return () => {
    if (preferenceCommitter === commit) preferenceCommitter = null;
  };
}
export function reduceSidebarPreferences(
  state: SidebarViewStoreState,
  update: SidebarPreferencePatch,
  targetMode: SidebarGroupMode = state.groupMode,
) {
  const profileState = { ...state, ...state.modeProfiles[targetMode] };
  const patch = typeof update === "function" ? update(profileState) : update;
  const { groupMode = state.groupMode, ...preferences } = patch;
  const modeProfiles = {
    ...state.modeProfiles,
    [targetMode]: SidebarModePreferencesSchema.parse({
      ...state.modeProfiles[targetMode],
      ...preferences,
    }),
  };
  return projectSidebarMode({ groupMode, modeProfiles, localModeFilters: state.localModeFilters });
}

/**
 * Re-keys a persisted filter through `workspaceLabelKey`, so the invariant on `labels` holds for
 * state that was written by an older build of this page rather than by the current one.
 */
function normalizeSidebarLabelFilter(filter: SidebarLabelFilter): SidebarLabelFilter {
  const labels = new Set(filter.labels.map(workspaceLabelKey));
  return { labels: [...labels] };
}

export function createSidebarViewStorage(
  backingStorage: StateStorage = AsyncStorage,
): StateStorage {
  return {
    getItem: async (name) => {
      const value = await backingStorage.getItem(name);
      if (value !== null || name !== SIDEBAR_VIEW_STORAGE_KEY) {
        return value;
      }
      return backingStorage.getItem(LEGACY_SIDEBAR_GROUP_MODE_STORAGE_KEY);
    },
    setItem: (name, value) => backingStorage.setItem(name, value),
    removeItem: (name) => backingStorage.removeItem(name),
  };
}

export function createSidebarPersistStorage(backingStorage: StateStorage = AsyncStorage) {
  return createValidatedPersistStorage(
    createSidebarViewStorage(backingStorage),
    SidebarViewPersistedStateSchema,
  );
}

const preferenceEditListeners = new Set<
  (next: SidebarViewStoreState, previous: SidebarViewStoreState) => void
>();

/** Observe user preference commands, excluding hydration, remote projection and reconciliation. */
export function subscribeSidebarPreferenceEdits(
  listener: (next: SidebarViewStoreState, previous: SidebarViewStoreState) => void,
): () => void {
  preferenceEditListeners.add(listener);
  return () => {
    preferenceEditListeners.delete(listener);
  };
}

export const useSidebarViewStore = create<SidebarViewStoreState>()(
  persist<SidebarViewStoreState, [], [], SidebarViewStorageState>(
    (set, get) => {
      const setPreferences = (
        patch:
          | Partial<SidebarViewStoreState>
          | ((state: SidebarViewStoreState) => Partial<SidebarViewStoreState>),
        targetMode: SidebarGroupMode = get().groupMode,
      ) => {
        if (getSettingsEditingBlocked()) return;
        if (!get().modeProfilesInitialized) return;
        const commit = preferenceCommitter;
        if (getSettingsHostSelected() && !commit) {
          set({ preferenceError: "Settings synchronization is unavailable" });
          return;
        }
        if (commit) {
          set((state) => ({
            preferencePendingCount: state.preferencePendingCount + 1,
            preferenceError: null,
          }));
          const save = async () => {
            try {
              await commit(patch, targetMode);
            } catch (error) {
              set({
                preferenceError:
                  error instanceof Error ? error.message : "Unable to save sidebar preferences",
              });
            } finally {
              set((state) => ({ preferencePendingCount: state.preferencePendingCount - 1 }));
            }
          };
          void save();
          return;
        }
        const previous = get();
        set(reduceSidebarPreferences(previous, patch, targetMode));
        for (const listener of preferenceEditListeners) listener(get(), previous);
      };
      const setLocalFilters = (
        update: (
          current: SidebarLocalModeFilters[SidebarGroupMode],
        ) => SidebarLocalModeFilters[SidebarGroupMode],
      ) => {
        set((state) =>
          projectSidebarMode({
            ...state,
            localModeFilters: {
              ...state.localModeFilters,
              [state.groupMode]: update(state.localModeFilters[state.groupMode]),
            },
          }),
        );
      };
      return {
        ...defaultSidebarModeProfiles().project,
        modeProfiles: defaultSidebarModeProfiles(),
        localModeFilters: defaultSidebarLocalModeFilters(),
        modeProfilesInitialized: false,
        preferenceError: null,
        preferencePendingCount: 0,
        setModePreferences: setPreferences,
        updateLocalFilters: setLocalFilters,
        showBackground: false,
        groupMode: "project",
        sortMode: "custom",
        workspaceSortMode: "custom",
        projectVisibility: "all",
        groupEmptyProjects: true,
        emptyProjectSortMode: "custom",
        hostFilters: [],
        projectFilters: [],
        labelFilter: emptyLabelFilter(),
        setEmptyProjectSortMode: (mode) => setPreferences({ emptyProjectSortMode: mode }),
        setGroupEmptyProjects: (enabled) => setPreferences({ groupEmptyProjects: enabled }),
        toggleModeEmptyProjects: (mode = get().groupMode) =>
          setPreferences((current) => ({ groupEmptyProjects: !current.groupEmptyProjects }), mode),
        toggleBackground: () =>
          setPreferences((state) => ({ showBackground: !state.showBackground })),
        setGroupMode: (mode) => setPreferences({ groupMode: mode }),
        toggleGroupMode: () =>
          setPreferences((current) => ({
            groupMode: current.groupMode === "status" ? "project" : "status",
          })),
        setWorkspaceSortMode: (mode) => setPreferences({ workspaceSortMode: mode }),
        setSortMode: (mode) => setPreferences({ sortMode: mode }),
        setProjectVisibility: (visibility) => setPreferences({ projectVisibility: visibility }),
        toggleHostFilter: (serverId) =>
          setLocalFilters((state) => ({
            ...state,
            hostFilters: toggleFilterEntry(state.hostFilters, serverId),
          })),
        clearHostFilters: () => setLocalFilters((state) => ({ ...state, hostFilters: [] })),
        selectProjectFilter: (viewKey) =>
          setLocalFilters((state) => ({ ...state, projectFilters: [viewKey] })),
        toggleProjectFilter: (viewKey) =>
          setLocalFilters((state) => ({
            ...state,
            projectFilters: toggleFilterEntry(state.projectFilters, viewKey),
          })),
        clearProjectFilters: () => setLocalFilters((state) => ({ ...state, projectFilters: [] })),
        toggleLabelFilter: (name) =>
          setPreferences((state) => {
            const key = workspaceLabelKey(name);
            const labels = state.labelFilter.labels.includes(key)
              ? state.labelFilter.labels.filter((label) => label !== key)
              : [...state.labelFilter.labels, key];
            return { labelFilter: { ...state.labelFilter, labels } };
          }),
        clearLabelFilter: () => setPreferences({ labelFilter: emptyLabelFilter() }),
        reconcileLabelFilter: (labels) =>
          set((state) => {
            if (getSettingsHostSelected()) return state;
            const available = new Set(labels.map(workspaceLabelKey));
            const next = state.labelFilter.labels.filter(
              (label) => label === SIDEBAR_UNLABELLED_LABEL_KEY || available.has(label),
            );
            if (next.length === state.labelFilter.labels.length) return state;
            return reduceSidebarPreferences(state, { labelFilter: { labels: next } });
          }),
        reconcileHostFilters: (serverIds) =>
          set((state) => {
            if (state.hostFilters.length === 0) {
              return state;
            }
            const allowed = new Set(serverIds);
            const next = state.hostFilters.filter((id) => allowed.has(id));
            if (next.length === state.hostFilters.length) {
              return state;
            }
            return projectSidebarMode({
              ...state,
              localModeFilters: {
                ...state.localModeFilters,
                [state.groupMode]: {
                  ...state.localModeFilters[state.groupMode],
                  hostFilters: next,
                },
              },
            });
          }),
      };
    },
    {
      name: SIDEBAR_VIEW_STORAGE_KEY,
      version: SIDEBAR_VIEW_STORE_VERSION,
      storage: createSidebarPersistStorage(),
      partialize: sidebarPersistedState,
      merge: (persisted, current) => ({ ...current, ...normalizeSidebarModeState(persisted) }),
      migrate: migrateSidebarPersistedState,
    },
  ),
);

function emptyLabelFilter(): SidebarLabelFilter {
  return { labels: [] };
}
