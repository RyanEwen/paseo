import { useMemo } from "react";
import type { ParsedDiffFile } from "@getpaseo/protocol/messages";
import type { AppSettings } from "@/hooks/use-settings/storage";
import type { WorkspaceWorkingDiffTabTarget } from "@/workspace-tabs/model";

interface DiffFileScopeInput {
  allFiles: ParsedDiffFile[];
  filePath: string | undefined;
  selectedPath: string | undefined;
  presentation: "tree" | "diff" | "combined";
  scope: AppSettings["explorerDiffScope"];
}

/** Narrows the document without removing other files from an inline Changes tree. */
export function resolveDiffFileScope(input: DiffFileScopeInput) {
  let filePath = input.filePath;
  if (!filePath && input.presentation === "combined" && input.scope === "single") {
    filePath = input.selectedPath;
  }
  const files = filePath ? input.allFiles.filter((file) => file.path === filePath) : input.allFiles;
  const treeFiles = input.presentation === "combined" ? input.allFiles : files;
  return { files, treeFiles };
}

interface DiffFileScopeHookInput extends Omit<DiffFileScopeInput, "selectedPath"> {
  focusRequest: { path: string } | null;
}

/** Keeps filtered documents stable across unrelated toolbar and selection renders. */
export function useDiffFileScope(input: DiffFileScopeHookInput) {
  const { allFiles, filePath, focusRequest, presentation, scope } = input;
  const selectedPath = focusRequest?.path;
  return useMemo(
    () => resolveDiffFileScope({ allFiles, filePath, selectedPath, presentation, scope }),
    [allFiles, filePath, selectedPath, presentation, scope],
  );
}

/** Creates a navigation target whose optional file scope survives tab reuse and reloads. */
export function changedFileDiffTarget(input: {
  path: string;
  scope: AppSettings["explorerDiffScope"];
  revision: number;
}): WorkspaceWorkingDiffTabTarget {
  return {
    kind: "working_diff",
    ...(input.scope === "single" ? { filePath: input.path } : {}),
    focusPath: input.path,
    focusRequestId: input.revision,
  };
}
