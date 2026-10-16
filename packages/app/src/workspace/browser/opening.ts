import type { NavigateToWorkspaceInput } from "@/stores/navigation-active-workspace-store";
import { isHttpUrl } from "@/utils/http-url";

export interface WorkspaceBrowserOpeningOwner {
  openWorkspace(input: NavigateToWorkspaceInput): void;
  resolveWorkspace(input: { serverId: string; workspaceId: string }): string | null;
  createBrowser(input: { initialUrl: string }): { browserId: string };
}

/** Resolve the destination before creating a tab, so stale links cannot leave orphan browsers. */
export function openWorkspaceBrowser(
  input: { serverId: string; workspaceId: string; url: string },
  owner: WorkspaceBrowserOpeningOwner,
): void {
  if (!isHttpUrl(input.url)) {
    throw new Error("Only absolute HTTP(S) URLs are supported.");
  }
  if (!input.workspaceId.trim()) {
    throw new Error("workspaceId is required.");
  }
  const workspaceId = owner.resolveWorkspace(input);
  if (!workspaceId) {
    throw new Error("Workspace is unavailable on the requested host.");
  }
  const { browserId } = owner.createBrowser({ initialUrl: input.url });
  owner.openWorkspace({
    serverId: input.serverId,
    workspaceId,
    target: { kind: "browser", browserId },
  });
}

export type BrowserLinkDestination = "paseo" | "external";

interface BrowserLinkDestinationsInput {
  url: string | null | undefined;
  hasWorkspaceBrowser: boolean;
  defaultDestination: BrowserLinkDestination;
}

/** Keep global and non-HTTP links unchanged; expose alternate destinations only in workspace scope. */
export function workspaceBrowserLinkDestinations(
  input: BrowserLinkDestinationsInput,
): BrowserLinkDestination[] {
  if (!input.url || !isHttpUrl(input.url)) {
    return [];
  }
  if (input.defaultDestination === "paseo") {
    return ["external"];
  }
  if (input.hasWorkspaceBrowser) {
    return ["paseo", "external"];
  }
  return [];
}

export interface WorkspaceLinkOpeningPolicy {
  isEnabled(): boolean;
  openInPaseo?: (url: string) => void | Promise<void>;
  openExternally(url: string): void | Promise<void>;
}

/** Decide at activation time, before awaiting anything, using the owning workspace opener. */
export async function openWorkspaceLink(
  url: string,
  policy: WorkspaceLinkOpeningPolicy,
): Promise<void> {
  const openInPaseo = policy.openInPaseo;
  if (isHttpUrl(url) && policy.isEnabled() && openInPaseo) {
    await openInPaseo(url);
    return;
  }
  await policy.openExternally(url);
}
