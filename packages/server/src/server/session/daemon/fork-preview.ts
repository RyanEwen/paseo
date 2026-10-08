import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";

const REPOSITORY = "RyanEwen/paseo";
const ReleaseSchema = z.object({
  tag_name: z.string(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  assets: z.array(z.object({ name: z.string(), browser_download_url: z.string().url() })),
});

/** Select published fork previews by their durable build number, independent of upstream versions. */
export function selectForkPreview(value: unknown) {
  const releases = z.array(ReleaseSchema).parse(value);
  const previews = releases.filter(
    (release) =>
      !release.draft &&
      release.prerelease &&
      /^v\d+\.\d+\.\d+-preview\.\d+$/.test(release.tag_name),
  );
  previews.sort(
    (left, right) =>
      Number(right.tag_name.split("preview.").pop()) -
      Number(left.tag_name.split("preview.").pop()),
  );
  const release = previews[0];
  if (!release) throw new Error("No published fork daemon preview is available");
  const filename = `paseo-daemon-${release.tag_name.slice(1)}-${process.platform}-${process.arch}.tgz`;
  const packageAsset = release.assets.find((asset) => asset.name === filename);
  const checksumAsset = release.assets.find((asset) => asset.name === "SHA256SUMS");
  if (!packageAsset || !checksumAsset)
    throw new Error(`Fork preview has no daemon package for ${process.platform}/${process.arch}`);
  for (const asset of [packageAsset, checksumAsset]) {
    const expected = `https://github.com/${REPOSITORY}/releases/download/${release.tag_name}/${asset.name}`;
    if (asset.browser_download_url !== expected)
      throw new Error("Unexpected fork release asset URL");
  }
  return { filename, packageAsset, checksumAsset };
}

/** Verify downloaded bytes before npm can replace the running installation. */
export function verifyForkChecksum(checksums: string, filename: string, bytes: Uint8Array): void {
  const entries = checksums.split("\n").filter((line) => line.endsWith(`  ${filename}`));
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (entries.length !== 1 || entries[0] !== `${digest}  ${filename}`) {
    throw new Error("Fork daemon package checksum mismatch");
  }
}

/** Read a public release resource with a bounded network request. */
async function requestRelease(url: string): Promise<Response> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(120_000),
    headers: { "User-Agent": "paseo-fork-updater" },
  });
  if (!response.ok) throw new Error(`Fork release download failed: HTTP ${response.status}`);
  return response;
}

interface DownloadOptions {
  request?: (url: string) => Promise<Response>;
}

/** Download only public releases; draft and incomplete releases never fall back to upstream npm. */
export async function downloadForkPreview({ request = requestRelease }: DownloadOptions = {}) {
  // Pagination avoids losing the newest preview behind stable releases or other prereleases.
  const releases = [];
  for (let page = 1; ; page += 1) {
    const response = await request(
      `https://api.github.com/repos/${REPOSITORY}/releases?per_page=100&page=${page}`,
    );
    const batch = z.array(ReleaseSchema).parse(await response.json());
    releases.push(...batch);
    if (batch.length < 100) break;
  }
  const preview = selectForkPreview(releases);
  const checksums = await (await request(preview.checksumAsset.browser_download_url)).text();
  const bytes = new Uint8Array(
    await (await request(preview.packageAsset.browser_download_url)).arrayBuffer(),
  );
  verifyForkChecksum(checksums, preview.filename, bytes);
  const directory = await mkdtemp(path.join(tmpdir(), "paseo-fork-update-"));
  const file = path.join(directory, preview.filename);
  try {
    await writeFile(file, bytes);
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return { file, cleanup: () => rm(directory, { recursive: true, force: true }) };
}
