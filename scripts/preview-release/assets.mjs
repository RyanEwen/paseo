import { createHash } from "node:crypto";
import {
  createReadStream,
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { dump, load } from "js-yaml";
import { isMainModule } from "../is-main-module.mjs";

const require = createRequire(import.meta.url);
const { archFromString, getArtifactArchName } = require("builder-util");

/** Match the packager's native architecture names, including amd64 and x86_64 Linux assets. */
function assetSuffix(arch, extension) {
  return `-${getArtifactArchName(archFromString(arch), extension)}.${extension}`;
}

const daemonTargets = ["linux-x64", "linux-arm64", "win32-x64", "win32-arm64"];

const desktopTargets = [
  {
    folder: "preview-windows-x64",
    arch: "x64",
    extensions: ["exe", "zip"],
    manifest: "preview.yml",
  },
  {
    folder: "preview-windows-arm64",
    arch: "arm64",
    extensions: ["exe", "zip"],
    manifest: "preview.yml",
  },
  {
    folder: "preview-linux-x64",
    arch: "x64",
    extensions: ["AppImage", "deb", "rpm", "tar.gz"],
    manifest: "preview-linux.yml",
  },
  {
    folder: "preview-linux-arm64",
    arch: "arm64",
    extensions: ["AppImage", "deb", "rpm", "tar.gz"],
    manifest: "preview-linux-arm64.yml",
  },
];

/** Hash files as streams; a multi-platform release can contain several gigabytes. */
async function hashFile(file, algorithm, encoding) {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
  }
  return hash.digest(encoding);
}

/** Reject mixed source commits, absent platforms, and manifests pointing at the wrong binary. */
function readBuildRelease(folder, expected) {
  const release = JSON.parse(readFileSync(path.join(folder, "preview-release.json"), "utf8"));
  for (const field of ["version", "tag", "commit", "androidVersionCode", "buildNumber"]) {
    if (release[field] !== expected[field]) {
      throw new Error(`${folder}: mismatched release ${field}`);
    }
  }
}

/** Copy one validated asset, refusing collisions between architecture builds. */
function copyAsset(source, output) {
  const name = path.basename(source);
  if (readdirSync(output).includes(name)) {
    throw new Error(`Duplicate release asset: ${name}`);
  }
  copyFileSync(source, path.join(output, name));
}

/** Validate updater hashes against uploaded bytes before making an update discoverable. */
async function validateManifest(manifest, folder, release) {
  if (
    manifest?.version !== release.version ||
    !Array.isArray(manifest.files) ||
    manifest.files.length === 0
  ) {
    throw new Error(`${folder}: missing updater files or wrong version`);
  }
  for (const file of manifest.files) {
    if (
      typeof file.url !== "string" ||
      path.basename(file.url) !== file.url ||
      file.url.includes("\\")
    ) {
      throw new Error(`${folder}: unsafe updater asset path`);
    }
    const actualHash = await hashFile(path.join(folder, file.url), "sha512", "base64");
    if (file.sha512 !== actualHash) {
      throw new Error(`${folder}: updater hash mismatch for ${file.url}`);
    }
  }
}

/** Assemble all approved platforms and updater channels, then emit downloadable checksums. */
export async function assemblePreviewAssets({
  input,
  output,
  release,
  releaseDate = new Date().toISOString(),
}) {
  mkdirSync(output, { recursive: true });
  if (readdirSync(output).length !== 0) {
    throw new Error("Preview release output must be empty");
  }
  const manifests = [];
  for (const target of desktopTargets) {
    const folder = path.join(input, target.folder);
    readBuildRelease(folder, release);
    const names = readdirSync(folder);
    for (const extension of target.extensions) {
      const candidates = names.filter((name) => name.endsWith(assetSuffix(target.arch, extension)));
      if (candidates.length !== 1) {
        throw new Error(`${target.folder}: expected one ${target.arch} ${extension} asset`);
      }
    }
    const manifest = load(readFileSync(path.join(folder, target.manifest), "utf8"));
    await validateManifest(manifest, folder, release);
    // Each OS/architecture manifest must include the actual installer it will select.
    const updateExtension = target.folder.includes("windows") ? "exe" : "AppImage";
    if (
      !manifest.files.some((file) => file.url.endsWith(assetSuffix(target.arch, updateExtension)))
    ) {
      throw new Error(`${target.folder}: missing updater installer for ${target.arch}`);
    }
    manifests.push({ ...manifest, releaseDate, rolloutHours: 0 });
    for (const name of names) {
      const isReleaseAsset = /\.(exe|zip|AppImage|deb|rpm|tar\.gz|blockmap)$/.test(name);
      if (isReleaseAsset) {
        copyAsset(path.join(folder, name), output);
      }
    }
  }

  for (const target of daemonTargets) {
    const folder = path.join(input, `preview-daemon-${target}`);
    readBuildRelease(folder, release);
    const name = `paseo-daemon-${release.version}-${target}.tgz`;
    copyAsset(path.join(folder, name), output);
  }

  const androidFolder = path.join(input, "preview-android");
  readBuildRelease(androidFolder, release);
  const apks = readdirSync(androidFolder).filter((name) => name.endsWith(".apk"));
  if (apks.length !== 1) {
    throw new Error("Expected one signed Android APK");
  }
  copyAsset(path.join(androidFolder, apks[0]), output);

  // Windows architectures share one channel file; Linux updater filenames include the architecture.
  const windowsManifest = {
    ...manifests[0],
    files: [...manifests[0].files, ...manifests[1].files],
  };
  writeFileSync(path.join(output, "preview.yml"), dump(windowsManifest));
  writeFileSync(path.join(output, "preview-linux.yml"), dump(manifests[2]));
  writeFileSync(path.join(output, "preview-linux-arm64.yml"), dump(manifests[3]));
  writeFileSync(path.join(output, "preview-release.json"), `${JSON.stringify(release, null, 2)}\n`);

  const checksumLines = [];
  for (const name of readdirSync(output).sort()) {
    const digest = await hashFile(path.join(output, name), "sha256", "hex");
    checksumLines.push(`${digest}  ${name}`);
  }
  writeFileSync(path.join(output, "SHA256SUMS"), `${checksumLines.join("\n")}\n`);
  await validatePreviewAssets({ directory: output, release });
}

/** Revalidate the final asset set at the publishing boundary, including its checksum inventory. */
export async function validatePreviewAssets({ directory, release }) {
  const names = readdirSync(directory).sort();
  for (const target of desktopTargets) {
    for (const extension of target.extensions) {
      if (names.filter((name) => name.endsWith(assetSuffix(target.arch, extension))).length !== 1) {
        throw new Error(`Incomplete release: missing or duplicated ${target.arch} ${extension}`);
      }
    }
  }
  for (const target of daemonTargets) {
    const name = `paseo-daemon-${release.version}-${target}.tgz`;
    if (!names.includes(name)) throw new Error(`Incomplete release: missing daemon ${target}`);
  }
  if (names.filter((name) => name.endsWith(".apk")).length !== 1) {
    throw new Error("Incomplete release: expected one Android APK");
  }
  for (const name of ["preview.yml", "preview-linux.yml", "preview-linux-arm64.yml"]) {
    await validateManifest(
      load(readFileSync(path.join(directory, name), "utf8")),
      directory,
      release,
    );
  }
  const checksums = readFileSync(path.join(directory, "SHA256SUMS"), "utf8").trim().split("\n");
  const inventory = [];
  for (const line of checksums) {
    const match = /^([a-f0-9]{64})  ([^/\\]+)$/.exec(line);
    if (!match) {
      throw new Error("Invalid release checksum inventory");
    }
    const [, expectedHash, name] = match;
    const actualHash = await hashFile(path.join(directory, name), "sha256", "hex");
    if (actualHash !== expectedHash) {
      throw new Error(`Release checksum mismatch: ${name}`);
    }
    inventory.push(name);
  }
  const expectedInventory = names.filter((name) => name !== "SHA256SUMS");
  if (JSON.stringify(inventory.sort()) !== JSON.stringify(expectedInventory)) {
    throw new Error("Release checksum inventory does not match the complete asset set");
  }
}

if (isMainModule(import.meta.url)) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    throw new Error(
      "Usage: node scripts/preview-release/assets.mjs <downloaded-artifacts> <release-dir>",
    );
  }
  const release = JSON.parse(readFileSync("preview-release.json", "utf8"));
  await assemblePreviewAssets({ input, output, release });
}
