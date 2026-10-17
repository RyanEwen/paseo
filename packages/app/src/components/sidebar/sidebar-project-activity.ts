import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
} from "@/hooks/use-sidebar-workspaces-list";
import type { HostRuntimeConnectionStatus } from "@/runtime/host-runtime";
import {
  aggregateKnownSidebarStateBuckets,
  type SidebarStateBucket,
} from "@/utils/sidebar-agent-state";

export interface SidebarProjectActivity {
  bucket: SidebarStateBucket | null;
  workingCount: number;
}

/** Summarize the caller's project catalog, including pinned children; unavailable hosts stay unknown. */
export function summarizeSidebarProjectActivity(
  projects: readonly SidebarProjectEntry[],
  entries: ReadonlyMap<string, SidebarWorkspaceEntry>,
  hostStatuses: ReadonlyMap<string, HostRuntimeConnectionStatus>,
): ReadonlyMap<string, SidebarProjectActivity> {
  return new Map(
    projects.map((project) => {
      const buckets = project.workspaces.map((workspace) => {
        if (hostStatuses.get(workspace.serverId) !== "online") return null;
        return entries.get(workspace.workspaceKey)?.statusBucket ?? null;
      });
      return [
        project.viewKey,
        {
          bucket: aggregateKnownSidebarStateBuckets(buckets),
          workingCount: buckets.filter((bucket) => bucket === "running").length,
        },
      ];
    }),
  );
}
