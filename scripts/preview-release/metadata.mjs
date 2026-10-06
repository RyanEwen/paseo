import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { isMainModule } from "../is-main-module.mjs";

const require = createRequire(import.meta.url);
const { getPreviewReleaseVersion } = require("../../packages/app/native-release-version.js");

/** Resolve one release identity from a fixed commit and the workflow's durable run number. */
export function resolvePreviewRelease({ upstreamVersion, buildNumber, commit }) {
  if (!/^[a-f0-9]{40}$/.test(commit)) {
    throw new Error("Preview source must be a full Git commit SHA");
  }
  const { version, appVersion, androidVersionCode } = getPreviewReleaseVersion(
    upstreamVersion,
    buildNumber,
  );

  return {
    version,
    upstreamVersion,
    appVersion,
    buildNumber,
    androidVersionCode,
    tag: `v${version}`,
    commit,
  };
}

if (isMainModule(import.meta.url)) {
  const upstreamVersion = JSON.parse(readFileSync("package.json", "utf8")).version;
  const release = resolvePreviewRelease({
    upstreamVersion,
    buildNumber: Number(process.env.PASEO_PREVIEW_BUILD_NUMBER),
    commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  });
  writeFileSync("preview-release.json", `${JSON.stringify(release, null, 2)}\n`);
  for (const name of ["version", "tag", "commit"]) {
    process.stdout.write(`${name}=${release[name]}\n`);
  }
}
