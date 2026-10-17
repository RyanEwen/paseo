import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";
import type { WorkspaceTitleSource } from "@/hooks/use-settings";
import { resolveSidebarWorkspacePrimaryLabel } from "./sidebar-workspace-title";

function matchesWorkspaceText(input: {
  workspace: SidebarWorkspacePlacement;
  entry: SidebarWorkspaceEntry | undefined;
  query: string;
  workspaceTitleSource: WorkspaceTitleSource;
  showBranch: boolean;
}): boolean {
  const workspace = input.entry ?? { name: input.workspace.name, currentBranch: null };
  return [
    workspace.name,
    input.entry?.title,
    resolveSidebarWorkspacePrimaryLabel({
      workspace,
      workspaceTitleSource: input.workspaceTitleSource,
    }),
    input.showBranch ? workspace.currentBranch : null,
  ].some((value) => value?.toLowerCase().includes(input.query));
}

/** Apply only after the mode's membership/pruning/sort projection, before pin and count windows. */
export function filterSidebarByText(input: {
  projects: SidebarProjectEntry[];
  entries: ReadonlyMap<string, SidebarWorkspaceEntry>;
  projectNames: ReadonlyMap<string, string>;
  text: string;
  workspaceTitleSource: WorkspaceTitleSource;
  showBranch: boolean;
}): { projects: SidebarProjectEntry[]; entries: ReadonlyMap<string, SidebarWorkspaceEntry> } {
  const query = input.text.trim().toLowerCase();
  if (!query) return { projects: input.projects, entries: input.entries };
  const projects = input.projects.flatMap((project) => {
    const title = input.projectNames.get(project.viewKey) ?? project.projectName;
    if (title.toLowerCase().includes(query)) return [project];
    const workspaces = project.workspaces.filter((workspace) =>
      matchesWorkspaceText({
        workspace,
        entry: input.entries.get(workspace.workspaceKey),
        query,
        workspaceTitleSource: input.workspaceTitleSource,
        showBranch: input.showBranch,
      }),
    );
    return workspaces.length ? [{ ...project, workspaces }] : [];
  });
  const keys = new Set(
    projects.flatMap((project) => project.workspaces.map((workspace) => workspace.workspaceKey)),
  );
  return { projects, entries: new Map([...input.entries].filter(([key]) => keys.has(key))) };
}
