import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { dump, load } from "js-yaml";
import { isMainModule } from "../is-main-module.mjs";
import { resolvePreviewRelease } from "./metadata.mjs";

const require = createRequire(import.meta.url);
const { getConfig } = require("app-builder-lib/out/util/config/config.js");

/** Prepare version and packaging inputs in a disposable checkout, leaving npm releases untouched. */
export async function preparePreviewBuild({
  root,
  buildNumber,
  commit,
  platform = process.platform,
  arch = process.arch,
  signingEnv = process.env,
}) {
  const rootPackage = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const release = resolvePreviewRelease({
    upstreamVersion: rootPackage.version,
    buildNumber,
    commit,
  });
  // Windows PE versions have four numeric slots; do not send a descriptive prerelease to rcedit.
  if (buildNumber > 65_535) {
    throw new Error("Preview build number exceeds the Windows PE version slot");
  }
  const buildVersion = `${release.appVersion}.${buildNumber}`;
  // electron-builder concatenates target arrays across extends. Resolve inheritance first so
  // a native ARM64 job cannot silently queue x64 targets inherited from the official config.
  const builderConfig = await getConfig(
    path.join(root, "packages/desktop"),
    "electron-builder.preview.yml",
    null,
  );
  delete builderConfig.extends;
  const previewConfig = load(
    readFileSync(path.join(root, "packages/desktop/electron-builder.preview.yml"), "utf8"),
  );
  // These arrays replace official registrations and launcher arguments rather than combining them.
  builderConfig.protocols = previewConfig.protocols;
  builderConfig.appImage.executableArgs = previewConfig.appImage.executableArgs;
  builderConfig.buildVersion = buildVersion;
  if (platform === "win32") {
    const signingFields = {
      publisherName: signingEnv.PASEO_AZURE_PUBLISHER_NAME,
      endpoint: signingEnv.PASEO_AZURE_SIGNING_ENDPOINT,
      certificateProfileName: signingEnv.PASEO_AZURE_CERTIFICATE_PROFILE,
      codeSigningAccountName: signingEnv.PASEO_AZURE_SIGNING_ACCOUNT,
    };
    for (const [field, value] of Object.entries(signingFields)) {
      if (!value?.trim()) {
        throw new Error(`Missing Azure Trusted Signing configuration: ${field}`);
      }
    }
    builderConfig.forceCodeSigning = true;
    if (arch !== "x64" && arch !== "arm64") {
      throw new Error(`Unsupported preview Windows architecture: ${arch}`);
    }
    builderConfig.win = {
      ...builderConfig.win,
      azureSignOptions: signingFields,
      target: [
        { target: "nsis", arch: [arch] },
        { target: "zip", arch: [arch] },
      ],
    };
  }

  // Validate every input before mutating the build checkout.
  for (const packageName of ["desktop", "app"]) {
    const packagePath = path.join(root, "packages", packageName, "package.json");
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
    packageJson.version = release.version;
    writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  }
  writeFileSync(
    path.join(root, "packages/desktop/electron-builder.preview.local.yml"),
    dump(builderConfig),
  );
  writeFileSync(path.join(root, "preview-release.json"), `${JSON.stringify(release, null, 2)}\n`);
  return release;
}

if (isMainModule(import.meta.url)) {
  const release = await preparePreviewBuild({
    root: process.cwd(),
    buildNumber: Number(process.env.PASEO_PREVIEW_BUILD_NUMBER),
    commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  });
  for (const [name, value] of Object.entries({
    version: release.version,
    tag: release.tag,
    commit: release.commit,
  })) {
    process.stdout.write(`${name}=${value}\n`);
  }
}
