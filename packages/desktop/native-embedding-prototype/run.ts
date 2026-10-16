/** Run native diagnostics on the Shared Browser's authenticated private display.
 * All executable paths are explicit; nothing is installed or downloaded here.
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Require a reviewed fixture dependency rather than silently selecting a host tool. */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} to an explicit fixture dependency path`);
  return value;
}
/** Retire only an owned fixture child and wait for exit before releasing its display. */
async function stop(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()));
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 2000);
  await exited;
  clearTimeout(timer);
}
async function main(): Promise<void> {
  const sharedDisplay = await import(pathToFileURL(required("PASEO_EMBED_DISPLAY_MODULE")).href);
  const chromium = required("PASEO_CHROMIUM_EXECUTABLE");
  const bridge = required("PASEO_X11_BRIDGE");
  const manager = required("PASEO_EMBED_WINDOW_MANAGER");
  const display = await sharedDisplay.createPrivateVirtualDisplay();
  if (!display) throw new Error("An authenticated private display is required");
  let windowManager: ChildProcess | undefined;
  let host: ChildProcess | undefined;
  try {
    const env = {
      ...process.env,
      ...display.launchEnvironment,
      PASEO_BROWSER_FIXTURE_PRIVATE_DISPLAY: "1",
      PASEO_EMBED_OUT: resolve(".dev/native-embed-evidence"),
      PASEO_CDP_PIPE_MODULE: resolve("packages/desktop/dist/features/browser-engine/cdp-pipe.js"),
      PASEO_CHROMIUM_EXECUTABLE: chromium,
      PASEO_X11_BRIDGE: bridge,
      PASEO_KEYS: resolve("docs/qa-evidence/browser-focus/private-display-keys.py"),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    windowManager = spawn(
      manager,
      ["--sm-disable", "--config-file", required("PASEO_EMBED_WINDOW_MANAGER_CONFIG")],
      { env, stdio: "inherit" },
    );
    const deadline = Date.now() + 5000;
    while (execFileSync(bridge, ["wm", "0"], { env, encoding: "utf8" }).trim() !== "1") {
      if (Date.now() > deadline || windowManager.exitCode !== null) {
        throw new Error("Private window manager failed to become ready");
      }
      await new Promise<void>((resolveWait) => setTimeout(resolveWait, 30));
    }
    host = spawn(
      resolve("node_modules/electron/dist/electron"),
      [resolve("packages/desktop/native-embedding-prototype/host.cjs")],
      { env, stdio: "inherit" },
    );
    const ownedHost = host;
    const timeout = setTimeout(() => ownedHost.kill("SIGKILL"), 75000);
    const exit = await new Promise<number | null>((resolveExit, reject) => {
      ownedHost.once("exit", resolveExit);
      ownedHost.once("error", reject);
    });
    clearTimeout(timeout);
    if (exit !== 0) throw new Error(`Native embedding fixture exited ${exit}`);
  } finally {
    await stop(host);
    await stop(windowManager);
    await display.stop();
  }
}
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
