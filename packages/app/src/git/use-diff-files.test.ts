import { changedFileDiffTarget, resolveDiffFileScope } from "./diff-scope";
import { describe, expect, it } from "vitest";
import type { CheckoutCommitFile, ParsedDiffFile } from "@getpaseo/protocol/messages";
import { resolveCommitDiffFiles } from "./use-diff-files";

function createCommitFile(
  overrides: Partial<CheckoutCommitFile> & { path: string },
): CheckoutCommitFile {
  return {
    path: overrides.path,
    additions: overrides.additions ?? 0,
    deletions: overrides.deletions ?? 0,
    ...(overrides.status ? { status: overrides.status } : {}),
  };
}

function createParsedDiffFile(
  overrides: Partial<ParsedDiffFile> & { path: string },
): ParsedDiffFile {
  return {
    path: overrides.path,
    isNew: overrides.isNew ?? false,
    isDeleted: overrides.isDeleted ?? false,
    additions: overrides.additions ?? 1,
    deletions: overrides.deletions ?? 0,
    hunks: overrides.hunks ?? [
      {
        oldStart: 1,
        oldCount: 1,
        newStart: 1,
        newCount: 1,
        lines: [{ type: "add", content: "x", tokens: [] }],
      },
    ],
    status: overrides.status,
  } as ParsedDiffFile;
}

describe("resolveCommitDiffFiles", () => {
  it("keeps pending commit files out of the shared view until their per-file diff resolves", () => {
    const files = [
      createCommitFile({ path: "blob.bin", status: "added" }),
      createCommitFile({ path: "src/app.ts", additions: 3, deletions: 1, status: "modified" }),
    ];

    const resolvedByPath = new Map<string, ParsedDiffFile | null | undefined>([
      ["blob.bin", undefined],
      [
        "src/app.ts",
        createParsedDiffFile({
          path: "src/app.ts",
          additions: 3,
          deletions: 1,
        }),
      ],
    ]);

    expect(resolveCommitDiffFiles(files, resolvedByPath)).toEqual([
      expect.objectContaining({
        path: "src/app.ts",
        additions: 3,
        deletions: 1,
      }),
    ]);
  });

  it("preserves binary-only commit files from commit metadata when the per-file diff is null", () => {
    const files = [
      createCommitFile({ path: "blob.bin", status: "added" }),
      createCommitFile({ path: "src/app.ts", additions: 3, deletions: 1, status: "modified" }),
    ];

    const resolvedByPath = new Map<string, ParsedDiffFile | null>([
      ["blob.bin", null],
      [
        "src/app.ts",
        createParsedDiffFile({
          path: "src/app.ts",
          additions: 3,
          deletions: 1,
        }),
      ],
    ]);

    expect(resolveCommitDiffFiles(files, resolvedByPath)).toEqual([
      {
        path: "blob.bin",
        isNew: true,
        isDeleted: false,
        additions: 0,
        deletions: 0,
        hunks: [],
        status: "binary",
      },
      expect.objectContaining({
        path: "src/app.ts",
        additions: 3,
        deletions: 1,
      }),
    ]);
  });
});

describe("changed-file diff scope", () => {
  const files = [createParsedDiffFile({ path: "a.ts" }), createParsedDiffFile({ path: "b.ts" })];

  it("shows all changes for an ordinary diff and only the requested file for a scoped diff", () => {
    const input = {
      allFiles: files,
      filePath: undefined,
      selectedPath: "b.ts",
      presentation: "diff" as const,
      scope: "single" as const,
    };
    expect(resolveDiffFileScope(input).files).toEqual(files);
    expect(resolveDiffFileScope({ ...input, filePath: "b.ts" }).files).toEqual([files[1]]);
    expect(resolveDiffFileScope({ ...input, filePath: "removed.ts" }).files).toEqual([]);
  });

  it("retains every tree entry when inline Changes shows only the selected file", () => {
    const input = {
      allFiles: files,
      filePath: undefined,
      selectedPath: "b.ts",
      presentation: "combined" as const,
      scope: "single" as const,
    };
    expect(resolveDiffFileScope(input)).toEqual({ files: [files[1]], treeFiles: files });
    expect(resolveDiffFileScope({ ...input, scope: "all" })).toEqual({ files, treeFiles: files });
    expect(resolveDiffFileScope({ ...input, selectedPath: undefined }).files).toEqual(files);
    expect(resolveDiffFileScope({ ...input, selectedPath: "removed.ts" })).toEqual({
      files: [],
      treeFiles: files,
    });
  });

  it("carries the preference into file selection targets", () => {
    expect(changedFileDiffTarget({ path: "a.ts", scope: "all", revision: 3 })).toEqual({
      kind: "working_diff",
      focusPath: "a.ts",
      focusRequestId: 3,
    });
    expect(changedFileDiffTarget({ path: "a.ts", scope: "single", revision: 3 })).toEqual({
      kind: "working_diff",
      filePath: "a.ts",
      focusPath: "a.ts",
      focusRequestId: 3,
    });
  });
});
