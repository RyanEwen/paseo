import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  downloadForkPreview,
  resolveForkPreview,
  selectForkPreview,
  verifyForkChecksum,
} from "./fork-preview.js";

function release(build: number, options: { draft?: boolean; missingPackage?: boolean } = {}) {
  const tag = `v0.11.1-preview.${build}`;
  const filename = `paseo-daemon-${tag.slice(1)}-${process.platform}-${process.arch}.tgz`;
  const names = options.missingPackage ? ["SHA256SUMS"] : [filename, "SHA256SUMS"];
  return {
    tag_name: tag,
    draft: options.draft ?? false,
    prerelease: true,
    assets: names.map((name) => ({
      name,
      browser_download_url: `https://github.com/RyanEwen/paseo/releases/download/${tag}/${name}`,
    })),
  };
}

describe("fork preview updates", () => {
  test("selects the newest published build and ignores drafts", () => {
    expect(
      selectForkPreview([release(9), release(12), release(13, { draft: true })]).filename,
    ).toBe(`paseo-daemon-0.11.1-preview.12-${process.platform}-${process.arch}.tgz`);
  });
  test("keeps a bridge visible to old hosts while upgraded hosts discover normal releases", () => {
    const bridge = release(77);
    const normal = { ...release(80), prerelease: false };
    const releases = [normal, bridge, release(76), release(81, { draft: true })];
    const legacyVisible = releases.filter((candidate) => candidate.prerelease);
    expect(selectForkPreview(legacyVisible).version).toBe("0.11.1-preview.77");
    expect(selectForkPreview(releases).version).toBe("0.11.1-preview.80");
    expect(() => selectForkPreview([{ ...normal, assets: [] }, bridge])).toThrow(
      "Fork preview has no daemon package",
    );
    normal.assets[0].browser_download_url += "?download=1";
    expect(() => selectForkPreview([normal])).toThrow("Unexpected fork release asset URL");
  });
  test("ignores other tag namespaces and refuses invalid workflow counters", () => {
    expect(
      selectForkPreview([
        { ...release(99), prerelease: false, tag_name: "v1.0.0" },
        { ...release(98), tag_name: "v1.0.0-beta.1" },
        release(77),
      ]).version,
    ).toBe("0.11.1-preview.77");
    for (const build of [0, 1_100_000_001, 10 ** 20]) {
      expect(() => selectForkPreview([release(build)])).toThrow("Invalid preview build number");
    }
  });
  test("refuses an incomplete newest preview rather than selecting older bytes", () => {
    expect(() => selectForkPreview([release(12, { missingPackage: true }), release(9)])).toThrow(
      "Fork preview has no daemon package",
    );
  });
  test("refuses a release asset outside the fork", () => {
    const preview = release(12);
    preview.assets[0].browser_download_url = "https://example.com/daemon.tgz";
    expect(() => selectForkPreview([preview])).toThrow("Unexpected fork release asset URL");
  });
  test("accepts matching bytes and rejects tampered or duplicate checksums", () => {
    const bytes = Buffer.from("daemon");
    const line = `${createHash("sha256").update(bytes).digest("hex")}  daemon.tgz`;
    expect(() => verifyForkChecksum(line, "daemon.tgz", bytes)).not.toThrow();
    expect(() => verifyForkChecksum(line, "daemon.tgz", Buffer.from("tampered"))).toThrow(
      "checksum mismatch",
    );
    expect(() => verifyForkChecksum(`${line}\n${line}`, "daemon.tgz", bytes)).toThrow(
      "checksum mismatch",
    );
  });
});

test("downloads the selected fork bytes, verifies them, and removes the temporary package", async () => {
  const preview = release(12);
  const bytes = Buffer.from("verified-daemon");
  const filename = preview.assets[0].name;
  const calls: string[] = [];
  const download = await downloadForkPreview({
    async request(url) {
      calls.push(url);
      if (url.includes("api.github.com")) return Response.json([preview]);
      if (url.endsWith("SHA256SUMS"))
        return new Response(`${createHash("sha256").update(bytes).digest("hex")}  ${filename}\n`);
      return new Response(bytes);
    },
  });
  try {
    expect(await readFile(download.file)).toEqual(bytes);
    expect(calls).toEqual([
      "https://api.github.com/repos/RyanEwen/paseo-plus-plus/releases?per_page=100&page=1",
      preview.assets[1].browser_download_url,
      preview.assets[0].browser_download_url,
    ]);
  } finally {
    await download.cleanup();
  }
  expect(existsSync(download.file)).toBe(false);
});

function renamedRelease() {
  const preview = release(12);
  for (const asset of preview.assets) {
    asset.browser_download_url = asset.browser_download_url.replace(
      "RyanEwen/paseo/",
      "RyanEwen/paseo-plus-plus/",
    );
  }
  return preview;
}

describe("daemon repository rename bridge", () => {
  test("accepts canonical assets from the renamed repository", () => {
    const preview = renamedRelease();
    expect(selectForkPreview([preview])).toEqual({
      version: "0.11.1-preview.12",
      filename: preview.assets[0].name,
      packageAsset: preview.assets[0],
      checksumAsset: preview.assets[1],
    });
  });

  test.each([
    ["RyanEwen", "paseo-plus-plus-extra"],
    ["AnotherOwner", "paseo-plus-plus"],
    ["getpaseo", "paseo"],
  ])("rejects an unapproved repository %s/%s", (owner, repository) => {
    const preview = renamedRelease();
    preview.assets[0].browser_download_url = preview.assets[0].browser_download_url.replace(
      "RyanEwen/paseo-plus-plus/",
      `${owner}/${repository}/`,
    );
    expect(() => selectForkPreview([preview])).toThrow("Unexpected fork release asset URL");
  });

  test.each(["?download=1", "#fragment", "/extra"])("rejects asset URL suffix %s", (suffix) => {
    const preview = renamedRelease();
    preview.assets[0].browser_download_url += suffix;
    expect(() => selectForkPreview([preview])).toThrow("Unexpected fork release asset URL");
  });

  test("rejects a different tag, filename, escaped path, protocol, or port", () => {
    const preview = renamedRelease();
    const url = preview.assets[0].browser_download_url;
    const replacements = [
      url.replace("preview.12", "preview.13"),
      url.replace(preview.assets[0].name, "other.tgz"),
      url.replace("/paseo-daemon-", "/%70aseo-daemon-"),
      url.replace("https:", "http:"),
      url.replace("github.com/", "github.com:443/"),
    ];
    for (const replacement of replacements) {
      preview.assets[0].browser_download_url = replacement;
      expect(() => selectForkPreview([preview])).toThrow("Unexpected fork release asset URL");
    }
  });

  test.each(["../daemon.tgz", "daemon..tgz", ".tgz", "daemon%20.tgz"])(
    "refuses a malformed daemon package name %s",
    (name) => {
      const preview = renamedRelease();
      preview.assets[0] = {
        name,
        browser_download_url: `https://github.com/RyanEwen/paseo-plus-plus/releases/download/${preview.tag_name}/${name}`,
      };
      expect(() => selectForkPreview([preview])).toThrow("Fork preview has no daemon package");
    },
  );

  test("discovers through the current API and downloads only the canonical package and checksum", async () => {
    const preview = renamedRelease();
    const filename = preview.assets[0].name;
    const bytes = Buffer.from("verified renamed daemon");
    const calls: string[] = [];
    const metadataUrl =
      "https://api.github.com/repos/RyanEwen/paseo-plus-plus/releases?per_page=100&page=1";
    const download = await downloadForkPreview({
      async request(url) {
        calls.push(url);
        if (url === metadataUrl) {
          const response = Response.json([preview]);
          Object.defineProperties(response, {
            url: {
              value: "https://api.github.com/repositories/123456/releases?per_page=100&page=1",
            },
            redirected: { value: true },
          });
          return response;
        }
        if (url === preview.assets[1].browser_download_url) {
          return new Response(`${createHash("sha256").update(bytes).digest("hex")}  ${filename}\n`);
        }
        if (url === preview.assets[0].browser_download_url) return new Response(bytes);
        throw new Error(`Unexpected test request: ${url}`);
      },
    });
    try {
      expect(await readFile(download.file)).toEqual(bytes);
      expect(calls).toEqual([
        metadataUrl,
        preview.assets[1].browser_download_url,
        preview.assets[0].browser_download_url,
      ]);
    } finally {
      await download.cleanup();
    }
    expect(existsSync(download.file)).toBe(false);
  });

  test("still rejects tampered bytes from a renamed canonical asset", async () => {
    const preview = renamedRelease();
    const filename = preview.assets[0].name;
    const digest = createHash("sha256").update("approved bytes").digest("hex");
    await expect(
      downloadForkPreview({
        async request(url) {
          if (url.startsWith("https://api.github.com/repos/RyanEwen/paseo-plus-plus/"))
            return Response.json([preview]);
          if (url === preview.assets[1].browser_download_url)
            return new Response(`${digest}  ${filename}\n`);
          if (url === preview.assets[0].browser_download_url) return new Response("tampered bytes");
          throw new Error(`Unexpected test request: ${url}`);
        },
      }),
    ).rejects.toThrow("checksum mismatch");
  });
});

test("availability discovers the platform package and checksum asset without downloading bytes", async () => {
  const calls: string[] = [];
  const preview = release(12);
  const result = await resolveForkPreview({
    request: async (url) => {
      calls.push(url);
      return Response.json([preview]);
    },
  });
  expect(result.version).toBe("0.11.1-preview.12");
  expect(calls).toEqual([
    "https://api.github.com/repos/RyanEwen/paseo-plus-plus/releases?per_page=100&page=1",
  ]);
});

test("availability refuses a missing checksum asset", async () => {
  const preview = release(12);
  preview.assets.pop();
  await expect(
    resolveForkPreview({ request: async () => Response.json([preview]) }),
  ).rejects.toThrow("Fork preview has no daemon package");
});
