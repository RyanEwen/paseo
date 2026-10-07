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
import { validateAndroidBundlePlan } from "./preview-release/android-bundle.mjs";
import { getAndroidCompilerBudget } from "./preview-release/android-compiler-budget.mjs";
import { verifyAndroidApkSigner } from "./preview-release/android-signer.mjs";
import { dump, load } from "js-yaml";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { getConfig, validateConfiguration } = require("app-builder-lib/out/util/config/config.js");
const { LinuxTargetHelper } = require("app-builder-lib/out/targets/LinuxTargetHelper.js");

const releaseDate = "2026-09-04T00:00:00.000Z";
const scriptPath = fileURLToPath(new URL("./validate-desktop-manifests.mjs", import.meta.url));

test("Android signer proof accepts SDK labels and rejects stamps or another signing identity", () => {
  const certificate = "ab".repeat(32);
  const other = "cd".repeat(32);
  for (const label of [
    "Signer #1",
    "Signer (minSdkVersion=33, maxSdkVersion=2147483647)",
    "V3.0 Signer:",
  ]) {
    const app = `${label} certificate SHA-256 digest: ${certificate}`;
    const stamp = `Source Stamp Signer: certificate SHA-256 digest: ${other}`;
    assert.equal(verifyAndroidApkSigner(`${app}\r\n${stamp}\r\n`, certificate), certificate);
    assert.throws(
      () => verifyAndroidApkSigner(app.replace(certificate, other), certificate),
      /does not match/,
    );
    assert.throws(
      () => verifyAndroidApkSigner(`${stamp}\n${app}\n${app}`, certificate),
      /exactly one/,
    );
  }
  assert.throws(
    () =>
      verifyAndroidApkSigner(
        `Source Stamp Signer: certificate SHA-256 digest: ${certificate}`,
        certificate,
      ),
    /exactly one/,
  );
  assert.throws(
    () =>
      verifyAndroidApkSigner(
        `Signer #1 certificate SHA-256 digest: ${certificate}\nSigner #2 certificate SHA-256 digest: ${other}`,
        certificate,
      ),
    /exactly one/,
  );
  assert.throws(
    () =>
      verifyAndroidApkSigner(
        `prefix Signer #1 certificate SHA-256 digest: ${certificate}`,
        certificate,
      ),
    /exactly one/,
  );
  assert.throws(
    () => verifyAndroidApkSigner(`Signer #1 certificate SHA-256 digest: ab`, certificate),
    /does not match/,
  );
  assert.throws(() => verifyAndroidApkSigner("", "ab"), /SHA-256 fingerprint/);
});

test(
  "Hermes cleanup reads explicit swap name and used-byte columns",
  { skip: process.platform !== "linux" },
  () => {
    const driver = readFileSync(
      new URL("./preview-release/android-hermes.sh", import.meta.url),
      "utf8",
    );
    const selection = driver.match(/sudo swapon ([^)]*)/);
    assert.ok(selection, "Cleanup must query actual swap activation");
    // Read the real util-linux table without changing any swap or memory settings.
    // Keep its header so an empty swap table still proves the selected column shape.
    const args = selection[1]
      .trim()
      .split(/\s+/)
      .filter((arg) => arg !== "--noheadings");
    const result = spawnSync("/usr/sbin/swapon", args, { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const [header, ...rows] = result.stdout.trim().split(/\n/);
    assert.deepEqual(header.trim().split(/\s+/), ["NAME", "USED"]);
    for (const row of rows) {
      const columns = row.trim().split(/\s+/);
      assert.equal(columns.length, 2);
      assert.match(columns[1], /^\d+$/);
    }
  },
);

test(
  "Hermes receipt distinguishes completion from failure and signal termination",
  { skip: process.platform !== "linux" },
  () => {
    const directory = mkdtempSync(path.join(tmpdir(), "paseo-hermes-receipt-"));
    try {
      for (const command of ["exit 0", "exit 17", "kill -TERM $$"]) {
        const receipt = path.join(directory, "exit.txt");
        rmSync(receipt, { force: true });
        const result = spawnSync(
          "bash",
          [
            fileURLToPath(new URL("./preview-release/android-hermes-result.sh", import.meta.url)),
            receipt,
            "bash",
            "-c",
            command,
          ],
          { encoding: "utf8" },
        );
        assert.equal(result.status === 0, command === "exit 0");
        assert.equal(readFileSync(receipt, "utf8").trim() === "0", command === "exit 0");
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test("Hermes capacity preserves disk and runner RAM under ancestor limits", () => {
  const GiB = 1024 ** 3;
  assert.deepEqual(getAndroidCompilerBudget(28 * GiB, 15 * GiB, ["max"]), {
    ram: 12 * GiB,
    swap: 16 * GiB,
  });
  assert.equal(getAndroidCompilerBudget(28 * GiB, 13 * GiB, ["max"]).ram, 10 * GiB);
  assert.throws(() => getAndroidCompilerBudget(28 * GiB, 13 * GiB, [12 * GiB]), /Finite ancestor/);
  assert.throws(() => getAndroidCompilerBudget(27 * GiB, 15 * GiB), /28 GiB free/);
  assert.throws(() => getAndroidCompilerBudget(28 * GiB, 6 * GiB), /Insufficient RAM/);
  assert.throws(() => getAndroidCompilerBudget(28 * GiB, 15 * GiB, ["unknown"]), /Finite ancestor/);
});

test("Android preview bundles retain release optimization and matching source maps", () => {
  const releasePlan = {
    dev: false,
    hermesEnabled: true,
    hermesFlags: ["-O", "-output-source-map"],
  };
  validateAndroidBundlePlan(releasePlan);
  for (const change of [
    { dev: true },
    { hermesEnabled: false },
    { hermesFlags: ["-Og", "-output-source-map"] },
    { hermesFlags: ["-O"] },
    { hermesFlags: ["-O", "-Og", "-output-source-map"] },
  ]) {
    assert.throws(
      () => validateAndroidBundlePlan({ ...releasePlan, ...change }),
      /Android previews/,
    );
  }
});

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
        // Use the filenames emitted by real electron-builder jobs, rather than generic arch labels.
        const linuxArchitectures = {
          x64: { AppImage: "x86_64", deb: "amd64", rpm: "x86_64" },
          arm64: { rpm: "aarch64" },
        };
        const artifactArch = os === "linux" ? (linuxArchitectures[arch][extension] ?? arch) : arch;
        const version = extension === "AppImage" ? "" : `${release.version}-`;
        const url = `Paseo-Debug-${version}${artifactArch}.${extension}`;
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
    for (const name of [
      "Paseo-Debug-x86_64.AppImage",
      "Paseo-Debug-0.11.0-preview.12-amd64.deb",
      "Paseo-Debug-0.11.0-preview.12-x86_64.rpm",
      "Paseo-Debug-0.11.0-preview.12-aarch64.rpm",
    ]) {
      assert.ok(names.includes(name), `Missing native Linux package: ${name}`);
    }
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
    const appImage = path.join(folder, "Paseo-Debug-arm64.AppImage");
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
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        version: "0.11.0-beta.5",
        workspaces: [
          "packages/desktop",
          "packages/app",
          "packages/server",
          "packages/cli",
          "packages/client",
        ],
      }),
    );
    for (const name of ["desktop", "app", "server", "cli", "client"]) {
      const folder = path.join(root, "packages", name);
      mkdirSync(folder, { recursive: true });
      writeFileSync(
        path.join(folder, "package.json"),
        JSON.stringify({
          name: `@getpaseo/${name}`,
          version: "0.11.0-beta.5",
          private: name === "desktop" || name === "app",
          dependencies: name === "client" ? {} : { "@getpaseo/client": "0.11.0-beta.5" },
        }),
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
    assert.deepEqual(config.appImage.executableArgs, ["--class=paseo-debug"]);
    assert.equal(config.linux.executableName, "paseo-debug");
    assert.equal(config.extraMetadata.desktopName, "paseo-debug.desktop");
    assert.deepEqual(config.linux.executableArgs, ["--class=paseo-debug"]);
    assert.equal(config.linux.desktop.entry.StartupWMClass, "paseo-debug");
    const desktopEntry = await new LinuxTargetHelper({
      executableName: config.linux.executableName,
      platformSpecificBuildOptions: config.linux,
      config,
      fileAssociations: [],
      appInfo: {
        productName: config.productName,
        sanitizedProductName: config.productName,
        description: "Preview desktop",
      },
    }).computeDesktopEntry(config.linux);
    assert.match(desktopEntry, /^Exec="\/opt\/Paseo Debug\/paseo-debug" --class=paseo-debug %U$/m);
    assert.match(desktopEntry, /^StartupWMClass=paseo-debug$/m);
    assert.equal(config.extraMetadata.paseoPreview, true);
    assert.equal(config.buildVersion, "0.11.0.12");
    for (const name of ["desktop", "app", "server", "cli", "client"]) {
      const pkg = JSON.parse(readFileSync(path.join(root, "packages", name, "package.json")));
      assert.equal(pkg.version, "0.11.0-preview.12");
      if (name !== "client") {
        assert.equal(pkg.dependencies["@getpaseo/client"], pkg.private ? "*" : pkg.version);
      }
    }
    assert.equal(
      JSON.parse(readFileSync(path.join(root, "package.json"))).version,
      "0.11.0-preview.12",
    );
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
