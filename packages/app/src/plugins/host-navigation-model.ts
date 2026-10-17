import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  openWorkspaceBrowser,
  type WorkspaceBrowserOpeningOwner,
} from "@/workspace/browser/opening";

interface HostNavigationOwner extends WorkspaceBrowserOpeningOwner {
  browserAvailable: boolean;
  openAgent(input: { serverId: string; agentId: string }): void;
}

export function createPluginHostNavigation(
  serverId: string,
  owner: HostNavigationOwner,
): NonNullable<PluginSurfaceProps["navigation"]> {
  return {
    openAgent: ({ agentId, serverId: targetServerId }) =>
      owner.openAgent({ serverId: targetServerId ?? serverId, agentId }),
    openWorkspace: ({ workspaceId, serverId: targetServerId }) =>
      owner.openWorkspace({ serverId: targetServerId ?? serverId, workspaceId }),
    openBrowser: owner.browserAvailable
      ? ({ url, workspaceId, serverId: targetServerId }) => {
          openWorkspaceBrowser({ serverId: targetServerId ?? serverId, workspaceId, url }, owner);
        }
      : undefined,
  };
}
