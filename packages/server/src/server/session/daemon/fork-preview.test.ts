import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { downloadForkPreview, selectForkPreview, verifyForkChecksum } from "./fork-preview.js";

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
      "https://api.github.com/repos/RyanEwen/paseo/releases?per_page=100&page=1",
      preview.assets[1].browser_download_url,
      preview.assets[0].browser_download_url,
    ]);
  } finally {
    await download.cleanup();
  }
  expect(existsSync(download.file)).toBe(false);
});
