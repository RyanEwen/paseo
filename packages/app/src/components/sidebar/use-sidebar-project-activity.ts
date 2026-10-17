import { useMemo } from "react";
import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
} from "@/hooks/use-sidebar-workspaces-list";
import { useHostRuntimeConnectionStatuses } from "@/runtime/host-runtime";
import { summarizeSidebarProjectActivity } from "./sidebar-project-activity";

/** React to workspace activity and host availability once for the supplied project collection. */
export function useSidebarProjectActivity(
  projects: readonly SidebarProjectEntry[],
  entries: ReadonlyMap<string, SidebarWorkspaceEntry>,
) {
  const serverIds = useMemo(
    () => [...new Set(projects.flatMap((project) => project.hosts.map((host) => host.serverId)))],
    [projects],
  );
  const hostStatuses = useHostRuntimeConnectionStatuses(serverIds);
  return useMemo(
    () => summarizeSidebarProjectActivity(projects, entries, hostStatuses),
    [projects, entries, hostStatuses],
  );
}
