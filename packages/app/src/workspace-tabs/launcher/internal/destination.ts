import { createDefaultLayout, findPaneById } from "@/stores/workspace-layout-actions";
import type { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import type { WorkspaceTabLaunchDestination } from "../index";

type LayoutState = ReturnType<typeof useWorkspaceLayoutStore.getState>;
interface LayoutOwner {
  getState(): Pick<LayoutState, "layoutByWorkspace" | "splitPaneEmpty">;
}

/** Capture a new placeholder before asynchronous creation so the result stays in its requested split. */
export function resolveWorkspaceTabLaunchDestination(
  workspaceKey: string,
  destination: WorkspaceTabLaunchDestination,
  owner: LayoutOwner,
): Exclude<WorkspaceTabLaunchDestination, { kind: "split" }> | null {
  if (destination.kind !== "split") return destination;
  const state = owner.getState();
  const currentLayout = state.layoutByWorkspace[workspaceKey] ?? createDefaultLayout();
  const targetPaneId = destination.paneId ?? currentLayout.focusedPaneId;
  if (!targetPaneId) return null;
  const paneId = state.splitPaneEmpty(workspaceKey, {
    targetPaneId,
    position: destination.position,
    firstPaneFraction: destination.firstPaneFraction,
  });
  if (!paneId) return null;
  const layout = owner.getState().layoutByWorkspace[workspaceKey];
  const tabId = findPaneById(layout.root, paneId)?.focusedTabId;
  return tabId ? { kind: "replace", tabId } : null;
}
