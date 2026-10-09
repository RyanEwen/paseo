import { describe, expect, it } from "vitest";
import { readApkChecksum, selectAndroidUpdate } from "./releases";

function release(build: number, version = "0.11.1") {
  const tag = `v${version}-preview.${build}`;
  const url = `https://github.com/RyanEwen/paseo/releases/download/${tag}/`;
  return {
    tag_name: tag,
    draft: false,
    prerelease: true,
    assets: [
      { name: "paseo.apk", browser_download_url: `${url}paseo.apk` },
      { name: "SHA256SUMS", browser_download_url: `${url}SHA256SUMS` },
    ],
  };
}

describe("fork Android update selection", () => {
  it("uses the workflow sequence across upstream versions and unordered releases", () => {
    expect(
      selectAndroidUpdate([release(12, "9.0.0"), release(14), release(13)], 1_000_000_013),
    ).toEqual({
      version: "0.11.1-preview.14",
      versionCode: 1_000_000_014,
      url: "https://github.com/RyanEwen/paseo/releases/download/v0.11.1-preview.14/paseo.apk",
      checksumUrl:
        "https://github.com/RyanEwen/paseo/releases/download/v0.11.1-preview.14/SHA256SUMS",
      filename: "paseo.apk",
    });
  });
  it("ignores drafts, upstream releases, and non-preview prereleases", () => {
    expect(
      selectAndroidUpdate(
        [
          { ...release(20), draft: true },
          { ...release(21), prerelease: false },
          { ...release(22), tag_name: "v0.11.2-beta.1" },
          release(13),
        ],
        1_000_000_013,
      ),
    ).toBeNull();
  });
  it("never offers a downgrade or the installed build", () => {
    expect(selectAndroidUpdate([release(13)], 1_000_000_014)).toBeNull();
    expect(selectAndroidUpdate([release(14)], 1_000_000_014)).toBeNull();
    expect(selectAndroidUpdate([], 1_000_000_014)).toBeNull();
  });
  it("refuses an incomplete newest release instead of selecting an older APK", () => {
    expect(() =>
      selectAndroidUpdate([release(13), { ...release(14), assets: [] }], 1_000_000_012),
    ).toThrow("missing its APK or checksum");
  });
  it("rejects duplicate APKs, untrusted URLs, unsafe names, and invalid build numbers", () => {
    const latest = release(14);
    expect(() =>
      selectAndroidUpdate([{ ...latest, assets: [...latest.assets, latest.assets[0]] }], 0),
    ).toThrow();
    latest.assets[0].browser_download_url = "https://example.com/paseo.apk";
    expect(() => selectAndroidUpdate([latest], 0)).toThrow("Unexpected fork release asset URL");
    const unsafe = release(14);
    unsafe.assets[0].name = "../paseo.apk";
    expect(() => selectAndroidUpdate([unsafe], 0)).toThrow("Unexpected fork release asset URL");
    expect(() => selectAndroidUpdate([release(1_100_000_001)], 0)).toThrow(
      "Invalid preview build number",
    );
  });
  it("requires exactly one valid checksum for the APK", () => {
    const digest = "a".repeat(64);
    expect(
      readApkChecksum(`${"b".repeat(64)}  other.zip\n${digest}  paseo.apk\n`, "paseo.apk"),
    ).toBe(digest);
    expect(() =>
      readApkChecksum(`${digest}  paseo.apk\n${digest}  paseo.apk`, "paseo.apk"),
    ).toThrow();
    expect(() => readApkChecksum("bad  paseo.apk", "paseo.apk")).toThrow();
    expect(() => readApkChecksum(`${digest}  other.apk`, "paseo.apk")).toThrow();
  });
});
