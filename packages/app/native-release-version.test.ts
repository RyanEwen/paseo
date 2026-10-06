import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
const { configureAndroidReleaseSigning } = require("./plugins/with-android-release-signing");

const {
  FDROID_ABI_VERSION_CODE_SUFFIXES,
  getFdroidVersionCodes,
  getNativeReleaseVersion,
  getPreviewReleaseVersion,
} = require("./native-release-version");

describe("native release version", () => {
  it("replaces development signing only in the installed Expo template's release build", () => {
    const template = path.join(path.dirname(require.resolve("expo/package.json")), "template.tgz");
    const gradle = execFileSync("tar", ["-xOf", template, "package/android/app/build.gradle"], {
      encoding: "utf8",
    });
    const configured = configureAndroidReleaseSigning(gradle);
    expect(configured).toMatch(/debug\s*\{\s*signingConfig signingConfigs.debug/);
    expect(configured).toMatch(/release\s*\{[^{}]*signingConfig signingConfigs.preview/);
    expect(configured).toContain('storePassword System.getenv("PASEO_ANDROID_KEYSTORE_PASSWORD")');
    expect(() => configureAndroidReleaseSigning("android {}")).toThrow("signing layout changed");
  });
  it("gives consecutive previews distinct Android codes while preserving upstream version math", () => {
    expect(getPreviewReleaseVersion("0.11.0-beta.5", 12)).toEqual({
      appVersion: "0.11.0",
      version: "0.11.0-preview.12",
      androidVersionCode: 1_000_000_012,
      iosBuildNumber: "11000005",
    });
    expect(getPreviewReleaseVersion("0.12.0-preview.13", 13).androidVersionCode).toBe(
      1_000_000_013,
    );
    expect(() => getPreviewReleaseVersion("0.11.0", 0)).toThrow("Preview build number");
    expect(() => getPreviewReleaseVersion("0.11.0", 1.5)).toThrow("Preview build number");
  });
  it("reserves the final iOS build slot for a stable release", () => {
    expect(getNativeReleaseVersion("0.2.6")).toEqual({
      appVersion: "0.2.6",
      androidVersionCode: 2006,
      iosBuildNumber: "2006999",
    });
  });

  it("gives each beta a unique iOS build slot under the stable app version", () => {
    expect(getNativeReleaseVersion("0.2.6-beta.2")).toEqual({
      appVersion: "0.2.6",
      androidVersionCode: 2006,
      iosBuildNumber: "2006002",
    });
  });

  it("rejects beta numbers that consume the stable iOS build slot", () => {
    expect(() => getNativeReleaseVersion("0.2.6-beta.999")).toThrow(
      "iOS beta number must be between 1 and 998",
    );
  });

  it("derives one F-Droid version code per published ABI", () => {
    expect(FDROID_ABI_VERSION_CODE_SUFFIXES).toEqual({
      "armeabi-v7a": 1,
      "arm64-v8a": 2,
      x86: 3,
      x86_64: 4,
    });
    expect(getFdroidVersionCodes("0.5.0")).toEqual([
      { abi: "armeabi-v7a", versionCode: 50001 },
      { abi: "arm64-v8a", versionCode: 50002 },
      { abi: "x86", versionCode: 50003 },
      { abi: "x86_64", versionCode: 50004 },
    ]);
  });
});
