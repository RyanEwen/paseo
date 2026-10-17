import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/contexts/toast-context";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { useSessionStore } from "@/stores/session-store";
import { hostSupportsFeature } from "@/runtime/host-features";
import { getHostRuntimeStore } from "@/runtime/host-runtime";

// Everything the pin toggle actually needs. Kept narrower than SidebarWorkspaceEntry so the
// global keyboard handler can build one from the active route selection without a sidebar row.
export type PinnableWorkspace = Pick<
  SidebarWorkspaceEntry,
  "serverId" | "workspaceId" | "workspaceKey" | "pinnedAt" | "projectPinnedAt"
>;

export type ToggleSidebarWorkspacePin = (
  workspace: PinnableWorkspace,
  scope?: "global" | "project",
) => void;

// Module scope, not a per-hook ref: the sidebar row menus and the global keyboard shortcut each
// hold their own controller instance, and a per-instance guard would let a keypress and a menu
// click fire two concurrent, opposite setWorkspacePinned calls for the same workspace.
const pendingWorkspaceKeys = new Set<string>();

/** Share pending ownership across menus and shortcuts; release it on success or failure. */
export function useSidebarWorkspacePinController(): ToggleSidebarWorkspacePin {
  const { t } = useTranslation();
  const toast = useToast();
  const mutation = useMutation({
    mutationFn: async ({
      workspace,
      pinned,
      scope,
    }: {
      workspace: PinnableWorkspace;
      pinned: boolean;
      scope: "global" | "project";
    }) => {
      const client = getHostRuntimeStore().getClient(workspace.serverId);
      if (!client) {
        throw new Error(t("sidebar.workspace.toasts.hostDisconnected"));
      }
      if (
        scope === "project" &&
        !hostSupportsFeature(
          useSessionStore.getState().sessions[workspace.serverId]?.serverInfo,
          "projectWorkspacePinning",
        )
      ) {
        throw new Error(t("sidebar.workspace.toasts.updateHostToPinInProject"));
      }
      await client.setWorkspacePinned(workspace.workspaceId, pinned, undefined, scope);
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : t("sidebar.workspace.toasts.hostDisconnected"),
      );
    },
    onSettled: (_data, _error, { workspace }) => {
      pendingWorkspaceKeys.delete(workspace.workspaceKey);
    },
  });
  const mutate = mutation.mutate;

  return useCallback(
    (workspace: PinnableWorkspace, scope: "global" | "project" = "global") => {
      if (pendingWorkspaceKeys.has(workspace.workspaceKey)) {
        return;
      }
      pendingWorkspaceKeys.add(workspace.workspaceKey);
      const pinnedAt = scope === "project" ? workspace.projectPinnedAt : workspace.pinnedAt;
      mutate({ workspace, pinned: pinnedAt == null, scope });
    },
    [mutate],
  );
}
