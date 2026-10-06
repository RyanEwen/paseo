import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import { validateDesktopManifests } from "./validate-desktop-manifests.mjs";
import { assemblePreviewAssets, validatePreviewAssets } from "./preview-release/assets.mjs";
import { preparePreviewBuild } from "./preview-release/prepare.mjs";
import { resolvePreviewRelease } from "./preview-release/metadata.mjs";
import { dump, load } from "js-yaml";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { getConfig, validateConfiguration } = require("app-builder-lib/out/util/config/config.js");

const releaseDate = "2026-09-04T00:00:00.000Z";
const scriptPath = fileURLToPath(new URL("./validate-desktop-manifests.mjs", import.meta.url));

function withManifest(contents, run) {
  const dir = mkdtempSync(path.join(tmpdir(), "paseo-validate-desktop-manifest-"));
  const manifestPath = path.join(dir, "latest-mac.yml");
  try {
    writeFileSync(manifestPath, contents);
    run(manifestPath);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

test("accepts a guarded macOS update manifest", () => {
  withManifest(
    `version: 0.7.3\nreleaseDate: '${releaseDate}'\nrolloutHours: 36\nminimumSystemVersion: 22.0.0\n`,
    (manifestPath) => {
      validateDesktopManifests({ releaseDate, rolloutHours: 36 }, [manifestPath]);
    },
  );
});

test("validates release manifests through the workflow CLI", () => {
  withManifest(
    `version: 0.7.3\nreleaseDate: '${releaseDate}'\nrolloutHours: 36\nminimumSystemVersion: 22.0.0\n`,
    (manifestPath) => {
      const result = spawnSync(
        process.execPath,
        [scriptPath, "--release-date", releaseDate, "--rollout-hours", "36", manifestPath],
        { encoding: "utf8" },
      );

      assert.equal(result.status, 0, result.stderr);
    },
  );
});

test("rejects a macOS update manifest without the system floor", () => {
  withManifest(
    `version: 0.7.3\nreleaseDate: '${releaseDate}'\nrolloutHours: 36\n`,
    (manifestPath) => {
      assert.throws(
        () => validateDesktopManifests({ releaseDate, rolloutHours: 36 }, [manifestPath]),
        /minimumSystemVersion=undefined, expected 22\.0\.0/,
      );
    },
  );
});

test("rejects invalid rollout metadata", () => {
  withManifest(
    `version: 0.7.3\nreleaseDate: '${releaseDate}'\nrolloutHours: 24\nminimumSystemVersion: 22.0.0\n`,
    (manifestPath) => {
      assert.throws(
        () => validateDesktopManifests({ releaseDate, rolloutHours: 36 }, [manifestPath]),
        /rolloutHours=24, expected 36/,
      );
    },
  );
});

/** Build real tiny files and matching manifests without invoking packaging or network services. */
async function withPreviewBuilds(run) {
  const root = mkdtempSync(path.join(tmpdir(), "paseo-preview-assets-"));
  const release = resolvePreviewRelease({
    upstreamVersion: "0.11.0-beta.5",
    buildNumber: 12,
    commit: "a".repeat(40),
  });
  const targets = [
    ["windows", "x64", ["exe", "zip"], "preview.yml"],
    ["windows", "arm64", ["exe", "zip"], "preview.yml"],
    ["linux", "x64", ["AppImage", "deb", "rpm", "tar.gz"], "preview-linux.yml"],
    ["linux", "arm64", ["AppImage", "deb", "rpm", "tar.gz"], "preview-linux-arm64.yml"],
  ];
  const input = path.join(root, "input");
  const output = path.join(root, "output");
  try {
    for (const [os, arch, extensions, manifestName] of targets) {
      const folder = path.join(input, `preview-${os}-${arch}`);
      mkdirSync(folder, { recursive: true });
      const files = [];
      for (const extension of extensions) {
        const url = `Paseo-Debug-${release.version}-${arch}.${extension}`;
        const bytes = Buffer.from(`${os}-${arch}-${extension}`);
        writeFileSync(path.join(folder, url), bytes);
        files.push({ url, sha512: createHash("sha512").update(bytes).digest("base64") });
      }
      writeFileSync(path.join(folder, "preview-release.json"), JSON.stringify(release));
      writeFileSync(path.join(folder, manifestName), dump({ version: release.version, files }));
    }
    const android = path.join(input, "preview-android");
    mkdirSync(android);
    writeFileSync(path.join(android, "preview-release.json"), JSON.stringify(release));
    writeFileSync(
      path.join(android, `Paseo-Debug-${release.version}-android.apk`),
      "signed-apk-fixture",
    );
    await run({ root, input, output, release });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("assembles both Windows architectures and distinct Linux update channels with complete checksums", async () => {
  await withPreviewBuilds(async (fixture) => {
    await assemblePreviewAssets({ ...fixture, releaseDate });
    const windows = load(readFileSync(path.join(fixture.output, "preview.yml"), "utf8"));
    assert.deepEqual(
      windows.files.map((file) => file.url),
      [
        "Paseo-Debug-0.11.0-preview.12-x64.exe",
        "Paseo-Debug-0.11.0-preview.12-x64.zip",
        "Paseo-Debug-0.11.0-preview.12-arm64.exe",
        "Paseo-Debug-0.11.0-preview.12-arm64.zip",
      ],
    );
    assert.equal(windows.releaseDate, releaseDate);
    assert.equal(windows.rolloutHours, 0);
    const names = readdirSync(fixture.output);
    assert.ok(names.includes("preview-linux-arm64.yml"));
    assert.equal(
      readFileSync(path.join(fixture.output, "SHA256SUMS"), "utf8").trim().split("\n").length,
      names.length - 1,
    );
    await validatePreviewAssets({ directory: fixture.output, release: fixture.release });
    writeFileSync(
      path.join(fixture.output, "Paseo-Debug-0.11.0-preview.12-android.apk"),
      "changed-bytes",
    );
    await assert.rejects(
      validatePreviewAssets({ directory: fixture.output, release: fixture.release }),
      /checksum mismatch/,
    );
  });
});

test("refuses a missing architecture, a mixed source commit, and a corrupt updater binary", async () => {
  await withPreviewBuilds(async (fixture) => {
    const folder = path.join(fixture.input, "preview-linux-arm64");
    const appImage = path.join(folder, "Paseo-Debug-0.11.0-preview.12-arm64.AppImage");
    rmSync(appImage);
    await assert.rejects(assemblePreviewAssets(fixture), /expected one arm64 AppImage/);
    rmSync(fixture.output, { recursive: true, force: true });
    writeFileSync(appImage, "linux-arm64-AppImage");
    writeFileSync(
      path.join(folder, "preview-release.json"),
      JSON.stringify({ ...fixture.release, commit: "b".repeat(40) }),
    );
    await assert.rejects(assemblePreviewAssets(fixture), /mismatched release commit/);
    rmSync(fixture.output, { recursive: true, force: true });
    writeFileSync(path.join(folder, "preview-release.json"), JSON.stringify(fixture.release));
    writeFileSync(appImage, "corrupt-bytes");
    await assert.rejects(assemblePreviewAssets(fixture), /updater hash mismatch/);
  });
});

test("prepares a Windows ARM64 build with inherited packaging and required Azure signing", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "paseo-preview-prepare-"));
  try {
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "0.11.0-beta.5" }));
    for (const name of ["desktop", "app"]) {
      const folder = path.join(root, "packages", name);
      mkdirSync(folder, { recursive: true });
      writeFileSync(
        path.join(folder, "package.json"),
        JSON.stringify({ name, version: "0.11.0-beta.5" }),
      );
    }
    const desktop = path.join(root, "packages/desktop");
    for (const name of ["electron-builder.yml", "electron-builder.preview.yml"]) {
      copyFileSync(
        new URL(`../packages/desktop/${name}`, import.meta.url),
        path.join(desktop, name),
      );
    }
    const input = {
      root,
      buildNumber: 12,
      commit: "a".repeat(40),
      platform: "win32",
      arch: "arm64",
    };
    await assert.rejects(preparePreviewBuild({ ...input, signingEnv: {} }), /Missing Azure/);
    assert.equal(
      JSON.parse(readFileSync(path.join(desktop, "package.json"))).version,
      "0.11.0-beta.5",
    );
    await preparePreviewBuild({
      ...input,
      signingEnv: {
        PASEO_AZURE_PUBLISHER_NAME: "Example Publisher",
        PASEO_AZURE_SIGNING_ENDPOINT: "https://eus.codesigning.azure.net",
        PASEO_AZURE_CERTIFICATE_PROFILE: "example",
        PASEO_AZURE_SIGNING_ACCOUNT: "example",
      },
    });
    const config = await getConfig(desktop, "electron-builder.preview.local.yml", null);
    validateConfiguration(config);
    assert.equal(config.appId, "sh.paseo.desktop.debug");
    assert.equal(config.productName, "Paseo Debug");
    assert.equal(config.publish.owner, "RyanEwen");
    assert.equal(config.publish.channel, "preview");
    assert.deepEqual(config.protocols, [
      { name: "Paseo preview agent link", schemes: ["paseo-debug"] },
    ]);
    assert.deepEqual(config.appImage.executableArgs, ["--class=Paseo Debug"]);
    assert.equal(config.extraMetadata.paseoPreview, true);
    assert.equal(config.buildVersion, "0.11.0.12");
    assert.equal(config.forceCodeSigning, true);
    assert.deepEqual(config.win.target, [
      { target: "nsis", arch: ["arm64"] },
      { target: "zip", arch: ["arm64"] },
    ]);
    assert.ok(config.files.length > 0);
    assert.equal(
      JSON.parse(readFileSync(path.join(root, "packages/app/package.json"))).version,
      "0.11.0-preview.12",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
