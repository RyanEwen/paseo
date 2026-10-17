import { usePanelStore } from "@/stores/panel-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import {
  prepareWorkspaceTab as prepareWorkspaceTabPure,
  type PrepareWorkspaceTabInput,
} from "./prepare-workspace-tab";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

export type { PrepareWorkspaceTabInput } from "./prepare-workspace-tab";

function layoutStoreDeps() {
  const store = useWorkspaceLayoutStore.getState();
  return {
    openTab: (input: {
      workspaceKey: string;
      target: WorkspaceTabTarget;
      intent: "reveal";
      pin?: boolean;
      placement?: import("@/stores/workspace-layout-actions").WorkspaceTabPlacement;
    }) => store.openTab(input),
  };
}

/** Open an explicit workspace target and reveal its compact content pane. */
export function prepareWorkspaceTab(input: PrepareWorkspaceTabInput): void {
  prepareWorkspaceTabPure(input, layoutStoreDeps());
  // Deferred route intents reach this owner after layout hydration.
  usePanelStore.getState().showMobileAgent();
}
