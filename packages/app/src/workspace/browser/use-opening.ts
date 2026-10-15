import { useMemo } from "react";
import { getIsElectron } from "@/constants/platform";
import { createWorkspaceBrowser } from "@/desktop/browser/store";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { useSessionStore } from "@/stores/session-store";
import { resolveWorkspaceMapKeyByIdentity } from "@/utils/workspace-identity";
import { openWorkspaceBrowser } from "./opening";

export type OpenWorkspaceBrowserUrl = (url: string) => void | Promise<void>;

/** Return a built-in desktop opener only for links that have an owning workspace. */
export function useWorkspaceBrowserOpening(
  serverId: string,
  workspaceId: string | null | undefined,
): OpenWorkspaceBrowserUrl | undefined {
  return useMemo(() => {
    if (!getIsElectron() || !workspaceId) {
      return undefined;
    }
    return (url: string) =>
      openWorkspaceBrowser(
        { serverId, workspaceId, url },
        {
          openWorkspace: navigateToWorkspace,
          createBrowser: createWorkspaceBrowser,
          resolveWorkspace: ({ serverId: targetServerId, workspaceId: targetWorkspaceId }) =>
            resolveWorkspaceMapKeyByIdentity({
              workspaces: useSessionStore.getState().sessions[targetServerId]?.workspaces,
              workspaceId: targetWorkspaceId,
            }),
        },
      );
  }, [serverId, workspaceId]);
}
