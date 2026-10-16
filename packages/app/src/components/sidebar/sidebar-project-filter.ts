import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
} from "@/hooks/use-sidebar-workspaces-list";
import type { WorkspaceStructureProject } from "@/projects/workspace-structure";

/** Keep an explicit project selection while revealing a successful Add Project result. */
export function includeCreatedProjectFilter(input: {
  projectFilters: string[];
  projects: readonly Pick<WorkspaceStructureProject, "viewKey" | "hosts">[];
  serverId: string;
  projectId: string;
}): string[] {
  const { projectFilters, projects, serverId, projectId } = input;
  const available = new Set(projects.map((project) => project.viewKey));
  if (resolveActiveProjectFilters(projectFilters, available).length === 0) return projectFilters;
  const created = projects.find((project) =>
    project.hosts.some((host) => host.serverId === serverId && host.projectId === projectId),
  );
  if (!created || projectFilters.includes(created.viewKey)) return projectFilters;
  return [...projectFilters, created.viewKey];
}

/**
 * The subset of a stored project filter that still names a project the sidebar can see.
 *
 * Empty means "all projects" — both when nothing is pinned and when everything pinned has gone
 * away. That second case is why nothing ever deletes a stored key: the project list is narrowed
 * by the host filter and is empty before any host connects, so absence does not mean the project
 * is gone. A filter goes inert while its host is away and comes back with it.
 *
 * This is the only definition of "is a project filter active". The menu's indicator, the
 * "All projects" check and the per-row selection all read it, so they cannot disagree with what
 * the list is actually doing.
 */
export function resolveActiveProjectFilters(
  projectFilters: readonly string[],
  availableViewKeys: ReadonlySet<string>,
): readonly string[] {
  if (projectFilters.length === 0) return EMPTY_PROJECT_FILTERS;
  const matching = projectFilters.filter((viewKey) => availableViewKeys.has(viewKey));
  return matching.length > 0 ? matching : EMPTY_PROJECT_FILTERS;
}

/**
 * Applies the Project page's selection to the sidebar's workspace entries.
 *
 * A workspace belongs to exactly one project, so this is a plain allowlist — no tri-state, and
 * no "unassigned" row of the kind the label filter needs.
 */
export function filterWorkspacesByProjects(input: {
  workspaces: readonly SidebarWorkspaceEntry[];
  projectFilters: readonly string[];
}): SidebarWorkspaceEntry[] {
  const { workspaces, projectFilters } = input;
  if (projectFilters.length === 0) return [...workspaces];
  const included = new Set(projectFilters);
  return workspaces.filter((workspace) => included.has(workspace.projectViewKey));
}

const EMPTY_PROJECT_FILTERS: readonly string[] = [];

/** Qualify colliding project names with their hosts, then paths if those hosts also collide. */
export function resolveSidebarProjectLabels(
  projects: readonly SidebarProjectEntry[],
  hosts: readonly { serverId: string; label: string }[],
): ReadonlyMap<string, string> {
  const hostLabels = new Map(
    hosts.map((host) => [host.serverId, host.label.trim() || host.serverId]),
  );
  const counts = new Map<string, number>();
  for (const project of projects) {
    counts.set(project.projectName, (counts.get(project.projectName) ?? 0) + 1);
  }
  const labels = new Map<string, string>();
  for (const project of projects) {
    let label = project.projectName;
    if ((counts.get(label) ?? 0) > 1) {
      const qualifier = project.hosts
        .map((host) => hostLabels.get(host.serverId) ?? host.serverId)
        .join(", ");
      label = `${label} (${qualifier})`;
    }
    labels.set(project.viewKey, label);
  }
  const qualifiedCounts = new Map<string, number>();
  for (const label of labels.values()) {
    qualifiedCounts.set(label, (qualifiedCounts.get(label) ?? 0) + 1);
  }
  for (const project of projects) {
    const label = labels.get(project.viewKey)!;
    if ((qualifiedCounts.get(label) ?? 0) > 1) {
      labels.set(project.viewKey, `${label} (${project.iconWorkingDir})`);
    }
  }
  return labels;
}
