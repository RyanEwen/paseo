import assert from "node:assert/strict";
import test from "node:test";
import { resolvePreviewRelease } from "./preview-release/metadata.mjs";
import {
  computeNextReleaseVersion,
  getReleaseInfoFromSourceTag,
  parseReleaseVersion,
} from "./release-version-utils.mjs";

test("computes the next beta patch from a stable version", () => {
  assert.equal(computeNextReleaseVersion("0.1.59", "beta-patch"), "0.1.60-beta.1");
});

test("advances beta versions", () => {
  assert.equal(computeNextReleaseVersion("0.1.60-beta.1", "beta-next"), "0.1.60-beta.2");
});

test("promotes beta versions to stable", () => {
  assert.equal(computeNextReleaseVersion("0.1.60-beta.2", "promote"), "0.1.60");
});

test("parses beta release metadata", () => {
  assert.deepEqual(parseReleaseVersion("0.1.60-beta.1"), {
    version: "0.1.60-beta.1",
    major: 0,
    minor: 1,
    patch: 60,
    prerelease: "beta.1",
    baseVersion: "0.1.60",
    isPrerelease: true,
    isBeta: true,
    betaNumber: 1,
  });
});

test("emits beta release info from tags", () => {
  assert.deepEqual(getReleaseInfoFromSourceTag("v0.1.60-beta.1"), {
    sourceTag: "v0.1.60-beta.1",
    releaseTag: "v0.1.60-beta.1",
    version: "0.1.60-beta.1",
    baseVersion: "0.1.60",
    prerelease: "beta.1",
    isPrerelease: true,
    isBeta: true,
    betaNumber: 1,
    releaseType: "prerelease",
    releaseChannel: "beta",
    isSmokeTag: false,
  });
});

test("rejects non-beta prerelease versions", () => {
  assert.throws(() => parseReleaseVersion("0.1.60-canary.1"), /Expected beta prerelease versions/);
});

test("fork previews have distinct release identities tied to one full commit", () => {
  const commit = "a".repeat(40);
  assert.deepEqual(
    resolvePreviewRelease({ upstreamVersion: "0.11.0-beta.5", buildNumber: 12, commit }),
    {
      version: "0.11.0-preview.12",
      upstreamVersion: "0.11.0-beta.5",
      appVersion: "0.11.0",
      buildNumber: 12,
      androidVersionCode: 1_000_000_012,
      tag: "v0.11.0-preview.12",
      commit,
    },
  );
  assert.throws(
    () => resolvePreviewRelease({ upstreamVersion: "0.11.0", buildNumber: 12, commit: "main" }),
    /full Git commit/,
  );
});
