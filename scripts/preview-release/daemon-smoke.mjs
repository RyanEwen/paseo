import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

/** Load process and client APIs from the installed package, rather than the checkout's dependencies. */
async function installedRuntime(packageRoot) {
  const serverRoot = path.join(packageRoot, "runtime/packages/server");
  const require = createRequire(path.join(serverRoot, "package.json"));
  const control = await import(
    pathToFileURL(require.resolve("@getpaseo/server/daemon-control")).href
  );
  const { DaemonClient } = await import(
    pathToFileURL(require.resolve("@getpaseo/client/internal/daemon-client")).href
  );
  const WebSocket = require("ws");
  return { serverRoot, control, DaemonClient, WebSocket };
}

/** Wait for a responsive worker at the expected version, including after an update changes its port. */
async function connectWorker({ runtime, home, version }) {
  const deadline = Date.now() + 60_000;
  let failure;
  while (Date.now() < deadline) {
    const instance = await runtime.control.readDaemonInstance(home);
    if (!instance?.listen) {
      await delay(100);
      continue;
    }
    const client = new runtime.DaemonClient({
      url: `ws://${instance.listen}/ws`,
      clientId: "fork-daemon-smoke",
      clientType: "cli",
      appVersion: version,
      localCredential: () => readFileSync(path.join(home, "local-credential"), "utf8").trim(),
      webSocketFactory: (url) => new runtime.WebSocket(url),
      connectTimeoutMs: 2_000,
      reconnect: { enabled: false },
    });
    try {
      await client.connect();
      const info = client.getLastServerInfoMessage();
      assert.equal(info.version, version);
      assert.equal(info.features.daemonSelfUpdate, true);
      return { client, instance, info };
    } catch (error) {
      failure = error;
      await client.close();
      await delay(100);
    }
  }
  throw new Error(`Installed worker did not become ready at ${version}`, { cause: failure });
}

/** Exercise native PTY spawning through the real daemon RPC, without using a provider or account. */
async function verifyTerminal({ client, home, workspaceId }) {
  const marker = path.join(home, "terminal-smoke.txt");
  const script = `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "native-terminal-ok"); setInterval(() => {}, 1000);`;
  const created = await client.createTerminal(home, "Package smoke", undefined, {
    workspaceId,
    command: process.execPath,
    args: ["-e", script],
  });
  assert.equal(created.error, null);
  assert.ok(created.terminal);
  try {
    const deadline = Date.now() + 15_000;
    while (!existsSync(marker) && Date.now() < deadline) await delay(100);
    assert.equal(await readFile(marker, "utf8"), "native-terminal-ok");
  } finally {
    const killed = await client.killTerminal(created.terminal.id);
    assert.equal(killed.success, true);
  }
}

/** Preserve the isolated home when ownership or confirmed process exit is unavailable. */
async function cleanupSmoke({ runtime, home, instance, client, startupTimedOut }) {
  let confirmed = !startupTimedOut;
  try {
    if (instance) {
      confirmed = false;
      await runtime.control.stopDaemonInstance(home, {
        instance,
        force: true,
        requestShutdown: async () => {
          if (!client) throw new Error("No smoke connection for graceful shutdown");
          await client.shutdownServer({ timeout: 10_000 });
        },
      });
      assert.equal(await runtime.control.readDaemonInstance(home), null);
      confirmed = true;
    }
  } finally {
    try {
      await client?.close();
    } finally {
      if (confirmed) await rm(home, { recursive: true, force: true });
      else process.stderr.write(`Smoke shutdown unconfirmed; preserved home: ${home}\n`);
    }
  }
}

/** Start an isolated installed daemon, optionally update through its public RPC, and confirm clean shutdown. */
export async function smokeRunningDaemon({ packageRoot, updateVersion }) {
  const manifest = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  const runtime = await installedRuntime(packageRoot);
  const home = await mkdtemp(path.join(tmpdir(), "paseo-fork-smoke-"));
  let client;
  let started;
  let acquiredInstance;
  let startupTimedOut = false;
  try {
    try {
      started = await runtime.control.startDaemonInstance({
        home,
        command: process.execPath,
        args: [path.join(runtime.serverRoot, "dist/scripts/supervisor-entrypoint.js")],
        env: {
          ...process.env,
          PASEO_LISTEN: "127.0.0.1:0",
          PASEO_RELAY_ENABLED: "false",
          PASEO_DICTATION_ENABLED: "false",
          PASEO_VOICE_MODE_ENABLED: "false",
        },
        mode: "deployment",
        timeoutMs: 60_000,
        onAcquired: (instance) => {
          acquiredInstance = instance;
        },
      });
    } catch (error) {
      startupTimedOut =
        error instanceof runtime.control.DaemonInstanceError && error.code === "DAEMON_NOT_READY";
      throw error;
    }
    let connected = await connectWorker({ runtime, home, version: manifest.version });
    client = connected.client;
    const createdWorkspace = await client.createWorkspace({
      source: { kind: "directory", path: home },
      title: "Daemon smoke workspace",
    });
    assert.equal(createdWorkspace.error, null);
    assert.ok(createdWorkspace.workspace);
    const workspaceId = createdWorkspace.workspace.id;
    await verifyTerminal({ client, home, workspaceId });
    if (updateVersion) {
      assert.notEqual(manifest.version, updateVersion);
      const previousServerId = connected.info.serverId;
      const updated = await client.updateDaemon();
      assert.deepEqual(updated, {
        requestId: updated.requestId,
        success: true,
        error: null,
        previousVersion: manifest.version,
        newVersion: updateVersion,
      });
      await client.close();
      connected = await connectWorker({ runtime, home, version: updateVersion });
      client = connected.client;
      assert.equal(connected.info.serverId, previousServerId);
      assert.equal(connected.instance.pid, started.instance.pid);
      await rm(path.join(home, "terminal-smoke.txt"));
      const workspaces = await client.fetchWorkspaces();
      assert.equal(
        workspaces.entries.some((workspace) => workspace.id === workspaceId),
        true,
      );
      await verifyTerminal({ client, home, workspaceId });
    }
    process.stdout.write(
      `Installed daemon startup, terminal RPC${updateVersion ? `, and update ${manifest.version} -> ${updateVersion}` : ""} verified\n`,
    );
  } finally {
    await cleanupSmoke({ runtime, home, instance: acquiredInstance, client, startupTimedOut });
  }
}
