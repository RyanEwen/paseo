import path from "node:path";
import { createRequire } from "node:module";
import { desktopDistribution } from "../../distribution.js";
import { resolveCliTargetFilename, resolveCliShimPath } from "./path.js";
import os from "node:os";
import { app } from "electron";

export function getLocalBinDir(): string {
  return path.join(os.homedir(), ".local", "bin");
}

export function getCliTargetPath(): string {
  const filename = resolveCliTargetFilename(process.platform, desktopDistribution.isPreview);
  return path.join(getLocalBinDir(), filename);
}

export function getBundledCliShimPath(): string {
  return resolveCliShimPath({
    platform: process.platform,
    isPackaged: app.isPackaged,
    executablePath: app.getPath("exe"),
    resolveWorkspaceCli: () => createRequire(__filename).resolve("@getpaseo/cli/bin/paseo"),
  });
}
