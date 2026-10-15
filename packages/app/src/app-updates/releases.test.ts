import { afterEach, describe, expect, it, vi } from "vitest";
import { findAndroidUpdate, readApkChecksum, selectAndroidUpdate } from "./releases";

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
          { ...release(21), tag_name: "v0.11.2", prerelease: false },
          { ...release(22), tag_name: "v0.11.2-beta.1" },
          release(13),
        ],
        1_000_000_013,
      ),
    ).toBeNull();
  });
  it("lets legacy discovery find the retained bridge and upgraded installs select normal releases", () => {
    const bridge = release(77);
    const normal = { ...release(80), prerelease: false };
    const releases = [normal, bridge, release(76), { ...release(81), draft: true }];
    // Published clients filter out normal releases before choosing their next update.
    const legacyVisible = releases.filter((candidate) => candidate.prerelease);
    expect(selectAndroidUpdate(legacyVisible, 1_000_000_076)?.versionCode).toBe(1_000_000_077);
    expect(selectAndroidUpdate(releases, 1_000_000_077)?.versionCode).toBe(1_000_000_080);
    expect(selectAndroidUpdate(releases, 1_000_000_080)).toBeNull();
    expect(selectAndroidUpdate(releases, 1_000_000_081)).toBeNull();
  });
  it("applies the same complete-asset and URL guards to normal releases", () => {
    const normal = { ...release(80), prerelease: false };
    expect(() => selectAndroidUpdate([release(77), { ...normal, assets: [] }], 0)).toThrow(
      "missing its APK or checksum",
    );
    normal.assets[0].browser_download_url += "?download=1";
    expect(() => selectAndroidUpdate([normal], 0)).toThrow("Unexpected fork release asset URL");
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

function renamedRelease() {
  const preview = release(14);
  for (const asset of preview.assets) {
    asset.browser_download_url = asset.browser_download_url.replace(
      "RyanEwen/paseo/",
      "RyanEwen/paseo-plus-plus/",
    );
  }
  return preview;
}

afterEach(() => vi.unstubAllGlobals());

describe("Android repository rename bridge", () => {
  it("accepts canonical assets from the future repository without changing version identity", () => {
    const preview = renamedRelease();
    expect(selectAndroidUpdate([preview], 1_000_000_013)).toEqual({
      version: "0.11.1-preview.14",
      versionCode: 1_000_000_014,
      url: preview.assets[0].browser_download_url,
      checksumUrl: preview.assets[1].browser_download_url,
      filename: "paseo.apk",
    });
  });

  it("keeps querying the old repository when the API returns renamed canonical assets", async () => {
    const response = Response.json([renamedRelease()]);
    // GitHub's API may redirect a renamed repository to its stable numeric ID.
    Object.defineProperties(response, {
      url: { value: "https://api.github.com/repositories/123456/releases?per_page=100&page=1" },
      redirected: { value: true },
    });
    const fetchResource = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchResource);
    const update = await findAndroidUpdate(1_000_000_013);
    expect(update?.url).toBe(renamedRelease().assets[0].browser_download_url);
    expect(fetchResource).toHaveBeenCalledExactlyOnceWith(
      "https://api.github.com/repos/RyanEwen/paseo/releases?per_page=100&page=1",
      { signal: expect.any(AbortSignal) },
    );
  });

  it.each([
    "https://github.com/AnotherOwner/paseo-plus-plus/releases/download/v0.11.1-preview.14/paseo.apk",
    "https://github.com/RyanEwen/another-repo/releases/download/v0.11.1-preview.14/paseo.apk",
    "https://github.com/getpaseo/paseo/releases/download/v0.11.1-preview.14/paseo.apk",
    "https://github.com/RyanEwen/paseo-plus-plus/releases/download/v0.11.1-preview.15/paseo.apk",
    "https://github.com/RyanEwen/paseo-plus-plus/releases/download/v0.11.1-preview.14/other.apk",
    "https://github.com/RyanEwen/paseo-plus-plus/releases/download/v0.11.1-preview.14/paseo.apk?download=1",
    "https://github.com/RyanEwen/paseo-plus-plus/releases/download/v0.11.1-preview.14/paseo.apk#fragment",
    "https://github.com/RyanEwen/paseo-plus-plus/releases/download/v0.11.1-preview.14/../paseo.apk",
    "https://github.com/RyanEwen/paseo-plus-plus/releases/download/v0.11.1-preview.14/%70aseo.apk",
    "https://github.com@evil.example/RyanEwen/paseo-plus-plus/releases/download/v0.11.1-preview.14/paseo.apk",
    "https://github.com:443/RyanEwen/paseo-plus-plus/releases/download/v0.11.1-preview.14/paseo.apk",
    "http://github.com/RyanEwen/paseo-plus-plus/releases/download/v0.11.1-preview.14/paseo.apk",
  ])("rejects a noncanonical renamed asset: %s", (url) => {
    const preview = renamedRelease();
    preview.assets[0].browser_download_url = url;
    expect(() => selectAndroidUpdate([preview], 1_000_000_013)).toThrow(
      "Unexpected fork release asset URL",
    );
  });

  it.each([".apk", "../paseo.apk", "paseo..apk", "paseo%20.apk", "paseo\\other.apk"])(
    "rejects malformed APK basename %s",
    (filename) => {
      const preview = renamedRelease();
      preview.assets[0] = {
        name: filename,
        browser_download_url: `https://github.com/RyanEwen/paseo-plus-plus/releases/download/${preview.tag_name}/${filename}`,
      };
      expect(() => selectAndroidUpdate([preview], 1_000_000_013)).toThrow(
        "Unexpected fork release asset URL",
      );
    },
  );

  it("rejects a renamed checksum URL with a query", () => {
    const preview = renamedRelease();
    preview.assets[1].browser_download_url += "?download=1";
    expect(() => selectAndroidUpdate([preview], 1_000_000_013)).toThrow(
      "Unexpected fork release asset URL",
    );
  });
});
