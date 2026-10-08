import path from "node:path";
import { readdir } from "node:fs/promises";

/**
 * Load this platform's PTY addons through node-pty's own resolver and return
 * their native directories. Pass a require function rooted in the runtime being
 * packaged or inspected. Missing addons fail the build or installed smoke.
 */
export function loadNativePtyModules(requireModule, platform = process.platform) {
  const loaderPath = requireModule.resolve("node-pty/lib/utils");
  const loader = requireModule(loaderPath);
  const names = platform === "win32" ? ["conpty", "conpty_console_list"] : ["pty"];
  const directories = new Set();
  for (const name of names) {
    const { dir } = loader.loadNativeModule(name);
    directories.add(path.resolve(path.dirname(loaderPath), dir));
  }
  return [...directories];
}

/** Collect runtime binaries, including bundled ConPTY, without compiler output or directory entries. */
export async function traceNativePtyFiles(requireModule, platform = process.platform) {
  const files = [];
  for (const directory of loadNativePtyModules(requireModule, platform)) {
    await collectRuntimeFiles(directory, files, false);
  }
  return files;
}

/** Only the bundled ConPTY subtree needs recursive data-file discovery. */
async function collectRuntimeFiles(directory, files, insideConpty) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory() && (insideConpty || entry.name === "conpty")) {
      await collectRuntimeFiles(file, files, true);
    } else if (
      entry.isFile() &&
      (entry.name === "spawn-helper" || /\.(node|dll|exe)$/i.test(entry.name))
    ) {
      files.push(file);
    }
  }
}
