import { runGitCommand } from "./run-git-command.js";
import { spawnProcess } from "./spawn.js";

/**
 * Delete a failed creation's branch only if its original tip is unchanged and unused.
 * Prepare locks the ref before checking worktrees. Concurrent checkout and ref updates
 * must then respect Git's lock, closing the check/delete window. Any failure rolls back.
 */
export async function removeUnusedGitBranch(
  cwd: string,
  branchName: string,
  initialTip: string,
): Promise<void> {
  const ref = `refs/heads/${branchName}`;
  const child = spawnProcess("git", ["-c", "core.fsmonitor=false", "update-ref", "--stdin"], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    signal: AbortSignal.timeout(30_000),
  });
  let output = "";
  let stderr = "";
  let processError: Error | undefined;
  let resolvePrepared!: () => void;
  let rejectPrepared!: (error: Error) => void;
  const prepared = new Promise<void>((resolve, reject) => {
    resolvePrepared = resolve;
    rejectPrepared = reject;
  });
  const closed = new Promise<number | null>((resolve) => {
    child.on("error", (error) => {
      processError = error;
      rejectPrepared(error);
    });
    child.on("close", (code) => {
      rejectPrepared(new Error(`Git rollback transaction ended before preparation: ${stderr}`));
      resolve(code);
    });
  });
  child.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8");
    if (output.split(/\r?\n/).includes("prepare: ok")) resolvePrepared();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString("utf8")).slice(-4096);
  });
  child.stdin?.on("error", (error) => rejectPrepared(error));
  // Some Git versions buffer acknowledgements until EOF. Do not make the
  // original setup error wait for the full process deadline in that case.
  const preparationTimer = setTimeout(() => {
    rejectPrepared(new Error("Git rollback preparation timed out; branch retained"));
  }, 2_000);

  try {
    // The expected old tip prevents deletion if setup or another process added commits.
    child.stdin!.write(`start\ndelete ${ref} ${initialTip}\nprepare\n`);
    await prepared;
    clearTimeout(preparationTimer);

    const { stdout } = await runGitCommand(["worktree", "list", "--porcelain"], {
      cwd,
      timeout: 15_000,
    });
    const checkedOut = stdout.split(/\r?\n/).some((line) => line === `branch ${ref}`);
    child.stdin!.end(checkedOut ? "abort\n" : "commit\n");
    const code = await closed;
    if (processError || code !== 0) {
      throw processError ?? new Error(`Git rollback transaction failed: ${stderr}`);
    }
  } finally {
    clearTimeout(preparationTimer);
    // EOF lets Git abort and remove its lock gracefully, including on Windows.
    // The process deadline bounds a hung transaction or repository hook.
    child.stdin?.end();
    await closed;
  }
}
