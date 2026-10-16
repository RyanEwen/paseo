import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, onTestFinished, test } from "vitest";

import { readPaseoWorktreeMetadata } from "../utils/worktree-metadata.js";
import { DaemonClient } from "./test-utils/index.js";
import { createTestPaseoDaemon } from "./test-utils/paseo-daemon.js";

// The reshaped workspace.create.request forwards its worktree `source`
// (action/refName/branchName/githubPrNumber/worktreeSlug) into createWorktreeCore.
// The regression these tests guard against is the daemon dropping action/refName
// while subsetting the request. We prove forwarding through the real workflow:
// the created worktree's observable branch is the only honest evidence the
// request fields reached git.

function createGitRepoWithBranch(): { repoDir: string; tempRoot: string } {
  const tempRoot = mkdtempSync(path.join(tmpdir(), "workspace-create-worktree-source-"));
  const repoDir = path.join(tempRoot, "repo");
  execFileSync("git", ["init", "-b", "main", repoDir], { stdio: "pipe" });
  execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: repoDir, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "test@getpaseo.local"], {
    cwd: repoDir,
    stdio: "pipe",
  });
  execFileSync("git", ["config", "user.name", "Paseo Test"], { cwd: repoDir, stdio: "pipe" });
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "initial"], {
    cwd: repoDir,
    stdio: "pipe",
  });
  // An existing branch the checkout action must target by refName.
  execFileSync("git", ["branch", "feature/existing-branch"], { cwd: repoDir, stdio: "pipe" });
  return { repoDir, tempRoot };
}

test("workspace.create worktree source forwards action=checkout + refName into the real worktree", async () => {
  const daemon = await createTestPaseoDaemon();
  const { repoDir, tempRoot } = createGitRepoWithBranch();
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.1.82",
  });

  try {
    await client.connect();

    const result = await client.createWorkspace({
      source: {
        kind: "worktree",
        cwd: repoDir,
        action: "checkout",
        refName: "feature/existing-branch",
      },
    });

    expect(result.error).toBeNull();
    // If action/refName were dropped, the daemon would branch-off a generated
    // slug instead of checking out the named branch. The created worktree being
    // on feature/existing-branch is the observable proof both fields forwarded.
    expect(result.workspace?.gitRuntime?.currentBranch).toBe("feature/existing-branch");
  } finally {
    await client.close().catch(() => undefined);
    await daemon.close();
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}, 180000);

test.each([false, true])(
  "workspace.create opens worktree.terminals (setup service: %s)",
  async (withSetupService) => {
    const daemon = await createTestPaseoDaemon();
    const { repoDir, tempRoot } = createGitRepoWithBranch();
    writeFileSync(
      path.join(repoDir, "paseo.json"),
      JSON.stringify({
        worktree: {
          ...(withSetupService
            ? {
                // Launch the Windows service asynchronously so it outlives
                // the setup command instead of holding setup open.
                setup:
                  process.platform === "win32"
                    ? "Start-Process -FilePath node -ArgumentList 'setup.cjs','serve' -WorkingDirectory (Get-Location).Path -WindowStyle Hidden; while (!(Test-Path setup-pid.txt)) { Start-Sleep -Milliseconds 25 }"
                    : "node setup.cjs",
              }
            : {}),
          terminals: [
            { name: "preview", command: "echo paseo-auto-terminal >> terminal-marker.txt" },
          ],
        },
      }),
    );
    writeFileSync(
      path.join(repoDir, "setup.cjs"),
      `
const fs = require("node:fs");
if (process.argv[2] === "serve") {
  require("node:net").createServer().listen(Number(process.env.PASEO_WORKTREE_PORT), "127.0.0.1", () => {
    fs.writeFileSync("setup-pid.txt", String(process.pid));
    process.send?.("ready");
  });
} else {
  const child = require("node:child_process").spawn(process.execPath, [__filename, "serve"], {
    detached: true,
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  child.once("message", () => { child.disconnect(); child.unref(); });
}
`,
    );
    execFileSync("git", ["add", "paseo.json", "setup.cjs"], { cwd: repoDir, stdio: "pipe" });
    execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "add paseo.json"], {
      cwd: repoDir,
      stdio: "pipe",
    });
    const client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      appVersion: "0.1.82",
    });

    let workspaceCwd: string | undefined;
    try {
      await client.connect();

      // This is the request the New Workspace screen sends: the workspace is
      // created on its own, with no agent in the same request.
      const result = await client.createWorkspace({
        source: {
          kind: "worktree",
          cwd: repoDir,
          action: "branch-off",
          branchName: "feature/auto-terminals",
          worktreeSlug: "feature-auto-terminals",
          baseBranch: "main",
        },
      });

      expect(result.error).toBeNull();
      const workspace = result.workspace;
      if (!workspace) {
        throw new Error("Expected a created workspace");
      }

      workspaceCwd = workspace.workspaceDirectory;
      if (withSetupService) {
        await expect
          .poll(() => existsSync(path.join(workspaceCwd!, "setup-pid.txt")), { timeout: 30000 })
          .toBe(true);
      }
      await expect
        .poll(async () => (await client.fetchWorkspaceSetupStatus(workspace.id)).snapshot, {
          timeout: 30000,
        })
        .toMatchObject({ status: "completed", error: null });
      await expect
        .poll(
          async () =>
            (
              await client.listTerminals(workspace.workspaceDirectory, undefined, {
                workspaceId: workspace.id,
              })
            ).terminals.map((terminal) => terminal.name),
          { timeout: 30000 },
        )
        .toContain("preview");
      await expect
        .poll(
          () => {
            const marker = path.join(workspaceCwd!, "terminal-marker.txt");
            return existsSync(marker) ? readFileSync(marker, "utf8").trim() : null;
          },
          { timeout: 10000 },
        )
        .toBe("paseo-auto-terminal");
      expect(
        (await client.listTerminals(workspaceCwd, undefined, { workspaceId: workspace.id }))
          .terminals,
      ).toHaveLength(1);
    } finally {
      const pidFile = workspaceCwd && path.join(workspaceCwd, "setup-pid.txt");
      if (pidFile && existsSync(pidFile)) {
        process.kill(Number(readFileSync(pidFile, "utf8")));
      }
      await client.close().catch(() => undefined);
      await daemon.close();
      await rm(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  },
  180000,
);

test("existing branch changes remain visible after archive and restore", async () => {
  const daemon = await createTestPaseoDaemon();
  const { repoDir, tempRoot } = createGitRepoWithBranch();
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.11.2",
  });
  onTestFinished(async () => {
    await client.close().catch(() => undefined);
    await daemon.close();
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  runGit(repoDir, "switch", "feature/existing-branch");
  commitFile(repoDir, "feature.txt", "feature change\n");
  runGit(repoDir, "switch", "main");
  await client.connect();
  const created = await client.createWorkspace({
    source: {
      kind: "worktree",
      cwd: repoDir,
      action: "checkout",
      refName: "feature/existing-branch",
    },
  });
  expect(created.error).toBeNull();
  const workspace = created.workspace!;
  const cwd = workspace.workspaceDirectory;
  const head = runGit(cwd, "rev-parse", "HEAD");
  const before = await client.getCheckoutDiff(cwd, { mode: "base" });
  expect(before.error).toBeNull();
  expect(before.files.map((file) => file.path)).toEqual(["feature.txt"]);
  expect((await client.getCheckoutStatus(cwd)).baseRef).toBe("main");
  expect((await client.archiveWorkspace(workspace.id)).error).toBeNull();
  expect(existsSync(cwd)).toBe(false);
  await client.restoreWorkspace(workspace.id);
  expect(runGit(cwd, "rev-parse", "HEAD")).toBe(head);
  expect((await client.getCheckoutStatus(cwd)).baseRef).toBe("main");
  const after = await client.getCheckoutDiff(cwd, { mode: "base" });
  expect(after.error).toBeNull();
  expect(after.files.map((file) => file.path)).toEqual(["feature.txt"]);
}, 180000);

test("workspace.create keeps a branch-off name separate from its worktree slug", async () => {
  const daemon = await createTestPaseoDaemon();
  const { repoDir, tempRoot } = createGitRepoWithBranch();
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.1.82",
  });

  try {
    await client.connect();

    const result = await client.createWorkspace({
      source: {
        kind: "worktree",
        cwd: repoDir,
        action: "branch-off",
        branchName: "feature/auth",
        worktreeSlug: "feature-auth",
        baseBranch: "main",
      },
    });

    expect(result.error).toBeNull();
    expect(result.workspace?.gitRuntime?.currentBranch).toBe("feature/auth");
    expect(path.basename(result.workspace?.workspaceDirectory ?? "")).toBe("feature-auth");
  } finally {
    await client.close().catch(() => undefined);
    await daemon.close();
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}, 180000);

test("workspace.create accepts a Git-valid branch-off name outside Paseo slug syntax", async () => {
  const daemon = await createTestPaseoDaemon();
  const { repoDir, tempRoot } = createGitRepoWithBranch();
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.1.82",
  });

  try {
    await client.connect();

    const result = await client.createWorkspace({
      source: {
        kind: "worktree",
        cwd: repoDir,
        action: "branch-off",
        branchName: "ABC-123_Fix-Broken-Model-Relationships_Author_Name",
        worktreeSlug: "git-valid-branch-name",
        baseBranch: "main",
      },
    });

    expect(result.error).toBeNull();
    expect(result.workspace?.gitRuntime?.currentBranch).toBe(
      "ABC-123_Fix-Broken-Model-Relationships_Author_Name",
    );
    expect(path.basename(result.workspace?.workspaceDirectory ?? "")).toBe("git-valid-branch-name");
  } finally {
    await client.close().catch(() => undefined);
    await daemon.close();
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}, 180000);

test("workspace.create always creates a new worktree when the slug is already occupied", async () => {
  const daemon = await createTestPaseoDaemon();
  const { repoDir, tempRoot } = createGitRepoWithBranch();
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.1.82",
  });

  try {
    await client.connect();

    const first = await client.createWorkspace({
      source: {
        kind: "worktree",
        cwd: repoDir,
        action: "branch-off",
        worktreeSlug: "same-slug",
        baseBranch: "main",
      },
    });
    const second = await client.createWorkspace({
      source: {
        kind: "worktree",
        cwd: repoDir,
        action: "branch-off",
        worktreeSlug: "same-slug",
        baseBranch: "main",
      },
    });

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(path.basename(first.workspace?.workspaceDirectory ?? "")).toBe("same-slug");
    expect(path.basename(second.workspace?.workspaceDirectory ?? "")).toBe("same-slug-1");
    expect(second.workspace?.id).not.toBe(first.workspace?.id);
  } finally {
    await client.close().catch(() => undefined);
    await daemon.close();
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}, 180000);

test("workspace.create suffixes past an occupied detached worktree", async () => {
  const daemon = await createTestPaseoDaemon();
  const { repoDir, tempRoot } = createGitRepoWithBranch();
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.1.82",
  });

  try {
    await client.connect();

    const first = await client.createWorkspace({
      source: {
        kind: "worktree",
        cwd: repoDir,
        action: "branch-off",
        worktreeSlug: "detached-slug",
        baseBranch: "main",
      },
    });
    expect(first.error).toBeNull();
    expect(first.workspace?.workspaceDirectory).toBeTypeOf("string");
    const firstPath = first.workspace?.workspaceDirectory as string;
    execFileSync("git", ["checkout", "--detach"], { cwd: firstPath, stdio: "pipe" });

    const second = await client.createWorkspace({
      source: {
        kind: "worktree",
        cwd: repoDir,
        action: "branch-off",
        worktreeSlug: "detached-slug",
        baseBranch: "main",
      },
    });

    expect(second.error).toBeNull();
    expect(path.basename(second.workspace?.workspaceDirectory ?? "")).toBe("detached-slug-1");
    expect(second.workspace?.gitRuntime?.currentBranch).toBe("detached-slug-1");
  } finally {
    await client.close().catch(() => undefined);
    await daemon.close();
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}, 180000);

test("workspace.create suffixes an occupied checkout branch", async () => {
  const daemon = await createTestPaseoDaemon();
  const { repoDir, tempRoot } = createGitRepoWithBranch();
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.1.82",
  });

  try {
    await client.connect();

    const first = await client.createWorkspace({
      source: {
        kind: "worktree",
        cwd: repoDir,
        action: "checkout",
        refName: "feature/existing-branch",
        worktreeSlug: "existing-branch",
      },
    });
    const second = await client.createWorkspace({
      source: {
        kind: "worktree",
        cwd: repoDir,
        action: "checkout",
        refName: "feature/existing-branch",
        worktreeSlug: "existing-branch",
      },
    });

    expect(first.error).toBeNull();
    expect(first.workspace?.gitRuntime?.currentBranch).toBe("feature/existing-branch");
    expect(second.error).toBeNull();
    expect(path.basename(second.workspace?.workspaceDirectory ?? "")).toBe("existing-branch-1");
    expect(second.workspace?.gitRuntime?.currentBranch).toBe("feature/existing-branch-1");
  } finally {
    await client.close().catch(() => undefined);
    await daemon.close();
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}, 180000);

function runGit(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
}
function commitFile(cwd: string, name: string, content: string): void {
  writeFileSync(path.join(cwd, name), content);
  runGit(cwd, "add", name);
  runGit(cwd, "-c", "commit.gpgsign=false", "commit", "-m", name);
}

test.each([
  ["refs/heads/main", "refs/remotes/origin/main"],
  ["refs/remotes/origin/main", "refs/heads/main"],
])(
  "restore preserves %s through comparison, update and local merge",
  async (baseRef, conflictingRef) => {
    const workspace = await createRestorableWorkspace(baseRef);
    await archiveAndRestoreWorkspace(workspace);
    await expectRestoredComparison(workspace, conflictingRef);
    await updateFromOriginalBase(workspace);
    await expectMergeIntoLocalBase(workspace);
  },
  180000,
);

test("restore preserves upstream comparison and update but rejects a missing local merge target", async () => {
  const workspace = await createRestorableWorkspace("refs/remotes/upstream/main");
  await archiveAndRestoreWorkspace(workspace);
  await expectRestoredComparison(workspace, "refs/heads/main");
  await updateFromOriginalBase(workspace);
  await expectMissingLocalMergeTarget(workspace);
}, 180000);

async function createRestorableWorkspace(baseRef: string) {
  const daemon = await createTestPaseoDaemon();
  const { repoDir, tempRoot } = createGitRepoWithBranch();
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws`, appVersion: "0.8.0" });
  onTestFinished(async () => {
    await client.close().catch(() => undefined);
    await daemon.close();
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  createDivergentBases(repoDir);
  await client.connect();
  const created = await client.createWorkspace({
    source: {
      kind: "worktree",
      cwd: repoDir,
      action: "branch-off",
      baseBranch: baseRef,
      branchName: "feature/restore",
      worktreeSlug: "restore-base",
    },
  });
  expect(created.error).toBeNull();
  const workspace = created.workspace!;
  const cwd = workspace.workspaceDirectory;
  commitFile(cwd, "feature.txt", "feature change\n");
  const head = runGit(cwd, "rev-parse", "HEAD");
  await client.checkoutRefresh(cwd);
  const before = await client.getCheckoutDiff(cwd, { mode: "base", baseRef: "main" });
  expect(before.error).toBeNull();
  expect(before.files.map((file) => file.path)).toEqual(["feature.txt"]);
  expect((await client.getCheckoutStatus(cwd)).baseRef).toBe("main");
  return { client, daemon, repoDir, workspace, cwd, head, before, baseRef };
}

type RestorableWorkspace = Awaited<ReturnType<typeof createRestorableWorkspace>>;

function createDivergentBases(repoDir: string): void {
  const root = runGit(repoDir, "rev-parse", "HEAD");
  // Same displayed name, three different commit streams.
  commitFile(repoDir, "local.txt", "local base\n");
  runGit(repoDir, "switch", "--detach", root);
  commitFile(repoDir, "origin.txt", "origin base\n");
  runGit(repoDir, "update-ref", "refs/remotes/origin/main", "HEAD");
  runGit(repoDir, "switch", "--detach", root);
  commitFile(repoDir, "upstream.txt", "upstream base\n");
  runGit(repoDir, "update-ref", "refs/remotes/upstream/main", "HEAD");
  runGit(repoDir, "switch", "main");
}

async function archiveAndRestoreWorkspace({ client, workspace, cwd }: RestorableWorkspace) {
  expect((await client.archiveWorkspace(workspace.id)).error).toBeNull();
  expect(existsSync(cwd)).toBe(false);
  expect(await client.inspectWorkspaceRecovery(workspace.id)).toMatchObject({ action: "restore" });
  await client.restoreWorkspace(workspace.id);
}

async function expectRestoredComparison(
  { client, daemon, workspace, cwd, head, before, baseRef }: RestorableWorkspace,
  conflictingRef: string,
) {
  const restoredStatus = await client.getCheckoutStatus(cwd);
  await client.checkoutRefresh(cwd);
  const after = await client.getCheckoutDiff(cwd, {
    mode: "base",
    baseRef: restoredStatus.baseRef ?? undefined,
  });
  expect(after.error).toBeNull();
  expect(after.files).toEqual(before.files);
  expect(runGit(cwd, "rev-parse", "HEAD")).toBe(head);
  expect(runGit(cwd, "branch", "--show-current")).toBe("feature/restore");
  expect(await client.getCheckoutStatus(cwd)).toMatchObject({
    baseRef: "main",
    aheadBehind: { ahead: 1, behind: 0 },
  });
  const history = await client.listCheckoutCommits(cwd);
  expect(history.baseRef).toBe(baseRef);
  expect(history.commits.filter((commit) => !commit.isOnBase).map((commit) => commit.sha)).toEqual([
    head,
  ]);
  expect((await client.getCommitFileDiff(cwd, head, "feature.txt")).file?.path).toBe("feature.txt");
  const records = JSON.parse(
    readFileSync(path.join(daemon.paseoHome, "projects/workspaces.json"), "utf8"),
  );
  expect(
    records.find((record: { workspaceId: string }) => record.workspaceId === workspace.id)
      .baseBranch,
  ).toBe(baseRef);
  expect(
    (await client.getCheckoutDiff(cwd, { mode: "base", baseRef: conflictingRef })).error?.message,
  ).toContain("Base ref mismatch");
}

async function updateFromOriginalBase({ client, repoDir, cwd, baseRef }: RestorableWorkspace) {
  // Advance only the chosen base; Update must not merge a same-named alternative.
  runGit(repoDir, "switch", "--detach", baseRef);
  commitFile(repoDir, "base-update.txt", `${baseRef}\n`);
  const baseUpdate = runGit(repoDir, "rev-parse", "HEAD");
  runGit(repoDir, "update-ref", baseRef, baseUpdate);
  runGit(repoDir, "switch", "main");
  await client.checkoutRefresh(cwd);
  expect(await client.getCheckoutStatus(cwd)).toMatchObject({
    aheadBehind: { ahead: 1, behind: 1 },
  });
  expect((await client.checkoutMergeFromBase(cwd, { baseRef: "main" })).error).toBeNull();
  expect(readFileSync(path.join(cwd, "base-update.txt"), "utf8")).toBe(`${baseRef}\n`);
  expect(runGit(cwd, "merge-base", baseUpdate, "HEAD")).toBe(baseUpdate);
  expect(
    (await client.getCheckoutDiff(cwd, { mode: "base", baseRef: "main" })).files.map(
      (file) => file.path,
    ),
  ).toEqual(["feature.txt"]);
}

async function expectMergeIntoLocalBase({ client, cwd, repoDir }: RestorableWorkspace) {
  expect(
    (
      await client.checkoutMerge(cwd, {
        baseRef: "main",
        strategy: "merge",
        requireCleanTarget: true,
      })
    ).error,
  ).toBeNull();
  expect(runGit(repoDir, "show", "main:feature.txt")).toBe("feature change");
}

async function expectMissingLocalMergeTarget({ client, cwd }: RestorableWorkspace) {
  expect(
    (
      await client.checkoutMerge(cwd, {
        baseRef: "main",
        strategy: "merge",
        requireCleanTarget: true,
      })
    ).error?.message,
  ).toContain("No local merge target is recorded");
}

test("exact workspace worktree choices preserve names, reject conflicts and adopt actual checkouts", async () => {
  const daemon = await createTestPaseoDaemon();
  const { repoDir, tempRoot } = createGitRepoWithBranch();
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.11.0-beta.5",
  });
  try {
    await client.connect();
    const opened = await client.openProject(repoDir);
    const projectId = opened.workspace!.projectId;
    const source = { kind: "worktree" as const, cwd: repoDir, projectId, exactNames: true };
    const checkout = await client.createWorkspace({
      source: {
        ...source,
        action: "checkout",
        refName: "feature/existing-branch",
        worktreeSlug: "existing-checkout",
      },
    });
    expect(checkout.error).toBeNull();
    expect(checkout.workspace!.gitRuntime?.currentBranch).toBe("feature/existing-branch");
    expect(path.basename(checkout.workspace!.workspaceDirectory)).toBe("existing-checkout");

    const occupied = await client.createWorkspace({
      source: {
        ...source,
        action: "checkout",
        refName: "feature/existing-branch",
        worktreeSlug: "another-checkout",
      },
    });
    expect(occupied.error).toContain("Select its existing worktree");
    expect(occupied.workspace).toBeNull();

    const branchOff = await client.createWorkspace({
      source: {
        ...source,
        action: "branch-off",
        refName: "refs/heads/main",
        branchName: "Feature/New.Branch",
        worktreeSlug: "feature-new-branch",
      },
      firstAgentContext: { prompt: "Do not rename my branch", attachments: [] },
    });
    expect(branchOff.error).toBeNull();
    expect(branchOff.workspace!.gitRuntime?.currentBranch).toBe("Feature/New.Branch");
    expect(path.basename(branchOff.workspace!.workspaceDirectory)).toBe("feature-new-branch");
    expect(
      readPaseoWorktreeMetadata(branchOff.workspace!.workspaceDirectory)?.firstAgentBranchAutoName,
    ).toBeUndefined();

    const collision = await client.createWorkspace({
      source: {
        ...source,
        action: "branch-off",
        refName: "main",
        branchName: "another-branch",
        worktreeSlug: "feature-new-branch",
      },
    });
    expect(collision.error).toContain("Choose another worktree name");
    // An occupied directory must not create a local tracking branch as a side effect.
    runGit(repoDir, "update-ref", "refs/remotes/origin/remote-only", "HEAD");
    const checkoutCollision = await client.createWorkspace({
      source: {
        ...source,
        action: "checkout",
        refName: "remote-only",
        worktreeSlug: "feature-new-branch",
      },
    });
    expect(checkoutCollision.error).toContain("Choose another worktree name");
    expect(runGit(repoDir, "branch", "--list", "remote-only")).toBe("");
    const branchCollision = await client.createWorkspace({
      source: {
        ...source,
        action: "branch-off",
        refName: "main",
        branchName: "Feature/New.Branch",
        worktreeSlug: "unique-name",
      },
    });
    expect(branchCollision.error).toContain("Branch already exists");
    for (const name of ["../escape", "UPPER", "", "two--hyphens"]) {
      const invalid = await client.createWorkspace({
        source: {
          ...source,
          action: "branch-off",
          refName: "main",
          branchName: "unused",
          worktreeSlug: name,
        },
      });
      expect(invalid.error).toContain("Invalid worktree name");
    }
    const concurrent = await Promise.all(
      ["concurrent-a", "concurrent-b"].map((branchName) =>
        client.createWorkspace({
          source: {
            ...source,
            action: "branch-off",
            refName: "main",
            branchName,
            worktreeSlug: "same-path",
          },
        }),
      ),
    );
    expect(concurrent.filter((result) => result.error === null)).toHaveLength(1);
    expect(concurrent.filter((result) => result.error !== null)).toHaveLength(1);
    const successful = concurrent.find((result) => result.workspace !== null)!;
    expect(path.basename(successful.workspace!.workspaceDirectory)).toBe("same-path");
    const invalidBranch = await client.createWorkspace({
      source: {
        ...source,
        action: "branch-off",
        refName: "main",
        branchName: "bad..branch",
        worktreeSlug: "valid-name",
      },
    });
    expect(invalidBranch.error).not.toBeNull();

    const externalPath = path.join(tempRoot, "external-checkout");
    execFileSync("git", ["worktree", "add", "-b", "external", externalPath, "main"], {
      cwd: repoDir,
      stdio: "pipe",
    });
    const listed = await client.getPaseoWorktreeList({ cwd: repoDir, includeAll: true });
    expect(listed.error).toBeNull();
    expect(listed.worktrees.map((entry) => entry.worktreePath)).toContain(externalPath);
    const before = execFileSync("git", ["worktree", "list", "--porcelain"], {
      cwd: repoDir,
    }).toString();
    for (const existingPath of [externalPath, checkout.workspace!.workspaceDirectory]) {
      const adopted = await client.createWorkspace({
        source: { kind: "directory", projectId, path: existingPath },
      });
      expect(adopted.error).toBeNull();
      expect(adopted.workspace!.workspaceDirectory).toBe(existingPath);
      expect(adopted.workspace!.projectId).toBe(projectId);
    }
    expect(
      execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: repoDir }).toString(),
    ).toBe(before);
    rmSync(externalPath, { recursive: true, force: true });
    const withoutMissing = await client.getPaseoWorktreeList({ cwd: repoDir, includeAll: true });
    expect(withoutMissing.error).toBeNull();
    expect(withoutMissing.worktrees.map((entry) => entry.worktreePath)).not.toContain(externalPath);
    const staleCheckout = await client.createWorkspace({
      source: {
        ...source,
        action: "checkout",
        refName: "external",
        worktreeSlug: "external-retry",
      },
    });
    expect(staleCheckout.error).toContain("git worktree prune");
    expect(staleCheckout.workspace).toBeNull();
    expect(
      execFileSync(
        "git",
        ["branch", "--list", "feature/existing-branch-1", "another-branch", "Feature/New.Branch-1"],
        { cwd: repoDir },
      )
        .toString()
        .trim(),
    ).toBe("");
  } finally {
    await client.close().catch(() => undefined);
    await daemon.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
}, 180000);
