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
  isCompact: boolean;
}

/** The acquisition scope and displayed document must select the same destination path. */
export function resolveDiffFilePath(input: Omit<DiffFileScopeInput, "allFiles">) {
  if (input.filePath !== undefined) return input.filePath;
  const selectsInPlace =
    input.presentation === "combined" || (input.isCompact && input.presentation === "diff");
  return selectsInPlace && input.scope === "single" ? input.selectedPath : undefined;
}

/** Narrows the document without removing other files from an inline Changes tree. */
export function resolveDiffFileScope(input: DiffFileScopeInput) {
  const filePath = resolveDiffFilePath(input);
  const files = filePath ? input.allFiles.filter((file) => file.path === filePath) : input.allFiles;
  const keepsCompactOverview = input.isCompact && !input.filePath;
  const keepsFileOverview = input.presentation === "combined" || keepsCompactOverview;
  const treeFiles = keepsFileOverview ? input.allFiles : files;
  return { files, treeFiles };
}

interface DiffFileScopeHookInput extends Omit<DiffFileScopeInput, "selectedPath"> {
  focusRequest: { path: string } | null;
}

/** Keeps filtered documents stable across unrelated toolbar and selection renders. */
export function useDiffFileScope(input: DiffFileScopeHookInput) {
  const { allFiles, filePath, focusRequest, presentation, scope, isCompact } = input;
  const selectedPath = focusRequest?.path;
  return useMemo(
    () =>
      resolveDiffFileScope({ allFiles, filePath, selectedPath, presentation, scope, isCompact }),
    [allFiles, filePath, selectedPath, presentation, scope, isCompact],
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
