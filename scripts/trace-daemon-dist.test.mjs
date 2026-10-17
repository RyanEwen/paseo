import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { createTraceIgnore } from "./trace-paths.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bridgeModule = "packages/server/dist/server/server/agent/providers/opencode/bridge.js";

test("trace boundaries reject external Windows volumes and preserve checkout dependencies", () => {
  const ignore = createTraceIgnore(["**/*.test.js", "node_modules/electron/**"], path.win32);
  const checkout = "D:\\a\\paseo\\paseo";
  for (const external of [
    "C:\\Users\\runneradmin\\Documents",
    "D:\\a\\private\\credentials.json",
    "\\\\server\\share\\config.js",
  ]) {
    assert.equal(ignore(path.win32.relative(checkout, external)), true, external);
  }
  assert.equal(ignore(".."), true);
  assert.equal(ignore("packages\\server\\dist\\index.js"), false);
  assert.equal(ignore("node_modules\\node-pty\\build\\Release\\conpty.node"), false);
  assert.equal(ignore("packages\\server\\dist\\index.test.js"), true);
  assert.equal(ignore("node_modules\\electron\\index.js"), true);
});

test("trace boundaries retain POSIX files and existing exclusions", () => {
  const ignore = createTraceIgnore(["**/*.test.js"], path.posix);
  assert.equal(ignore("/home/runner/private.json"), true);
  assert.equal(ignore("../private.json"), true);
  assert.equal(ignore("packages/server/dist/index.js"), false);
  assert.equal(ignore("packages/server/dist/index.test.js"), true);
});

// Mirrors nix/package.nix's installPhase: copy every traced path into $out.
async function installTracedDaemon(outRoot) {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [path.join(repoRoot, "scripts/trace-daemon.mjs")],
    { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 },
  );
  for (const file of stdout.split("\n").filter(Boolean)) {
    await cp(path.join(repoRoot, file), path.join(outRoot, file), {
      recursive: true,
      verbatimSymlinks: true,
    });
  }
}

test("traced daemon closure ships the OpenCode bridge plugin for every OpenCode version", async () => {
  const outRoot = await mkdtemp(path.join(os.tmpdir(), "trace-daemon-dist-"));
  try {
    await installTracedDaemon(outRoot);
    const installedBridgeUrl = pathToFileURL(path.join(outRoot, bridgeModule)).href;
    const { loadOpenCodeBridgePluginArtifact } = await import(installedBridgeUrl);

    for (const version of [1, 2]) {
      const artifact = await loadOpenCodeBridgePluginArtifact(
        installedBridgeUrl,
        undefined,
        version,
      );
      assert.ok(artifact.byteLength > 0, `OpenCode v${version} bridge plugin is empty`);
    }
  } finally {
    await rm(outRoot, { recursive: true, force: true });
  }
});
