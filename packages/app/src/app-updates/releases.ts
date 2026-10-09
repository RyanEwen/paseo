import { z } from "zod";

const repository = "RyanEwen/paseo";
const assetSchema = z.object({ name: z.string(), browser_download_url: z.url() });
export const releasesSchema = z.array(
  z.object({
    tag_name: z.string(),
    draft: z.boolean(),
    prerelease: z.boolean(),
    assets: z.array(assetSchema),
  }),
);

export interface AndroidUpdate {
  version: string;
  versionCode: number;
  url: string;
  checksumUrl: string;
  filename: string;
}

/** Select by the preview workflow sequence, which stays monotonic across upstream versions. */
export function selectAndroidUpdate(value: unknown, installedCode: number): AndroidUpdate | null {
  const releases = releasesSchema.parse(value);
  const previews = releases.flatMap((release) => {
    const match = /^v\d+\.\d+\.\d+-preview\.(\d+)$/.exec(release.tag_name);
    if (release.draft || !release.prerelease || !match) return [];
    const build = Number(match[1]);
    if (!Number.isSafeInteger(build) || build < 1 || build > 1_100_000_000) {
      throw new Error("Invalid preview build number");
    }
    return [{ release, code: 1_000_000_000 + build }];
  });
  previews.sort((a, b) => b.code - a.code);
  const latest = previews[0];
  if (!latest || latest.code <= installedCode) return null;

  const apks = latest.release.assets.filter((asset) => asset.name.endsWith(".apk"));
  const checksum = latest.release.assets.find((asset) => asset.name === "SHA256SUMS");
  if (apks.length !== 1 || !checksum) throw new Error("Preview is missing its APK or checksum");
  const apk = apks[0];
  for (const asset of [apk, checksum]) {
    const safeName = /^[A-Za-z0-9._-]+$/.test(asset.name);
    const expected = `https://github.com/${repository}/releases/download/${latest.release.tag_name}/${asset.name}`;
    if (!safeName || asset.browser_download_url !== expected) {
      throw new Error("Unexpected fork release asset URL");
    }
  }
  return {
    version: latest.release.tag_name.slice(1),
    versionCode: latest.code,
    url: apk.browser_download_url,
    checksumUrl: checksum.browser_download_url,
    filename: apk.name,
  };
}

/** Reject absent or ambiguous checksums before asking native code to download an APK. */
export function readApkChecksum(text: string, filename: string): string {
  const entries = text.split("\n").filter((line) => line.endsWith(`  ${filename}`));
  if (entries.length !== 1 || !/^[a-f0-9]{64}  /.test(entries[0])) {
    throw new Error("Invalid APK checksum inventory");
  }
  return entries[0].slice(0, 64);
}

/** Bound each metadata request; public releases need no GitHub credentials. */
export async function requestUpdateResource(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Update request failed (HTTP ${response.status})`);
    // Consume metadata inside the timeout, not only the response headers.
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

/** Read every release page so unrelated tags cannot hide the newest fork preview. */
export async function findAndroidUpdate(installedCode: number): Promise<AndroidUpdate | null> {
  const releases: z.infer<typeof releasesSchema> = [];
  for (let page = 1; ; page += 1) {
    const response = await requestUpdateResource(
      `https://api.github.com/repos/${repository}/releases?per_page=100&page=${page}`,
    );
    const batch = releasesSchema.parse(JSON.parse(response));
    releases.push(...batch);
    if (batch.length < 100) break;
  }
  return selectAndroidUpdate(releases, installedCode);
}
