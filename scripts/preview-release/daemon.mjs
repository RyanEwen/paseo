import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { isMainModule } from "../is-main-module.mjs";
import { smokeRunningDaemon } from "./daemon-smoke.mjs";
import { stageDaemonRuntime } from "./runtime.mjs";
import { syncWorkspaceVersions } from "../sync-workspace-versions.mjs";

/** Stage the existing traced runtime as a dependency-free npm tarball for this native host. */
export function buildDaemonPackage({ root, output, release }) {
  const staging = path.join(output, "package");
  mkdirSync(staging, { recursive: true });
  try {
    const files = execFileSync(process.execPath, [path.join(root, "scripts/trace-daemon.mjs")], {
      cwd: root,
      encoding: "utf8",
    })
      .trim()
      .split("\n");
    stageDaemonRuntime({ root, output: path.join(staging, "runtime"), files });
    writeFileSync(path.join(staging, "runtime/package.json"), JSON.stringify({ type: "module" }));
    mkdirSync(path.join(staging, "bin"));
    const launcher = path.join(staging, "bin/paseo-fork");
    writeFileSync(
      launcher,
      '#!/usr/bin/env node\nimport "../runtime/packages/cli/dist/index.js";\n',
    );
    chmodSync(launcher, 0o755);
    writeFileSync(
      path.join(staging, "package.json"),
      JSON.stringify(
        {
          name: "@ryanewen/paseo-daemon",
          version: release.version,
          type: "module",
          bin: { "paseo-fork": "bin/paseo-fork" },
          engines: { node: ">=22" },
          os: [process.platform],
          cpu: [process.arch],
          paseoPreview: release,
        },
        null,
        2,
      ),
    );
    const filename = `paseo-daemon-${release.version}-${process.platform}-${process.arch}.tgz`;
    execFileSync("tar", ["-czf", path.join(output, filename), "-C", output, "package"], {
      stdio: "inherit",
    });
    writeFileSync(path.join(output, "preview-release.json"), JSON.stringify(release, null, 2));
    return path.join(output, filename);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/** Check the installed distribution identity and native modules, without starting a host daemon. */
export async function smokeDaemonPackage(packageRoot) {
  const manifest = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  const serverRoot = path.join(packageRoot, "runtime/packages/server");
  const runtime = path.join(serverRoot, "dist/server/server/session/daemon");
  const npmModule = await import(pathToFileURL(path.join(runtime, "npm-global-cli.js")).href);
  if (npmModule.PASEO_CLI_PACKAGE !== manifest.name)
    throw new Error("Installed daemon lost its fork update identity");
  const serverManifest = JSON.parse(readFileSync(path.join(serverRoot, "package.json"), "utf8"));
  if (serverManifest.version !== manifest.version)
    throw new Error("Installed daemon version does not match its distribution");
  const require = createRequire(path.join(serverRoot, "package.json"));
  const ptyUtils = require("node-pty/lib/utils");
  ptyUtils.loadNativeModule("pty");
  const speech = require("sherpa-onnx-node");
  if (typeof speech.OfflineRecognizer !== "function") {
    throw new Error("Installed speech runtime is unavailable");
  }
  const version = execFileSync(
    process.execPath,
    [path.join(packageRoot, "bin/paseo-fork"), "--version"],
    { encoding: "utf8" },
  ).trim();
  if (version !== manifest.version)
    throw new Error(`Installed CLI reports unexpected version: ${version}`);
  process.stdout.write(
    `Installed fork daemon ${version}: distribution and native modules verified\n`,
  );
}

if (isMainModule(import.meta.url) && process.argv[2] === "--smoke") {
  const packageRoot = path.resolve(process.argv[3]);
  await smokeDaemonPackage(packageRoot);
  await smokeRunningDaemon({ packageRoot });
} else if (isMainModule(import.meta.url)) {
  const root = process.cwd();
  const release = JSON.parse(readFileSync("preview-release.json", "utf8"));
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  manifest.version = release.version;
  writeFileSync("package.json", JSON.stringify(manifest, null, 2));
  syncWorkspaceVersions(root);
  execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build:server"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build:daemon-web-ui"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  buildDaemonPackage({ root, output: path.resolve("preview-daemon"), release });
}
