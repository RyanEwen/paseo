import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { WorkspaceRenameModal } from "@/components/workspace-rename-modal";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";

const RenameWorkspaceContext = createContext<((workspace: SidebarWorkspaceEntry) => void) | null>(
  null,
);

/** Keep the status-mode rename dialog mounted when sorting moves its row into a hidden group. */
export function SidebarWorkspaceRename({ children }: { children: ReactNode }) {
  const [workspace, setWorkspace] = useState<SidebarWorkspaceEntry | null>(null);
  const close = useCallback(() => setWorkspace(null), []);
  return (
    <RenameWorkspaceContext value={setWorkspace}>
      {children}
      {workspace ? (
        <WorkspaceRenameModal
          visible
          workspace={workspace}
          onClose={close}
          testID={`sidebar-workspace-rename-modal-${workspace.workspaceKey}`}
        />
      ) : null}
    </RenameWorkspaceContext>
  );
}

/** Open the single dialog with a snapshot, keeping its initial value stable while statuses change. */
export function useSidebarWorkspaceRename() {
  const open = useContext(RenameWorkspaceContext);
  if (!open) throw new Error("SidebarWorkspaceRename is required");
  return open;
}
