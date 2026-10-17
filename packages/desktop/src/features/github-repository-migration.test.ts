import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { IncomingMessage, type RequestOptions } from "node:http";
import { Socket } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CancellationToken } from "builder-util-runtime";
import { NsisUpdater } from "electron-updater";
import { ElectronHttpExecutor } from "electron-updater/out/electronHttpExecutor";
import { GitHubProvider } from "electron-updater/out/providers/GitHubProvider";
import type { AppAdapter } from "electron-updater/out/AppAdapter";
import { describe, expect, it } from "vitest";

interface RedirectResource {
  kind: "redirect";
  url: string;
}
interface BodyResource {
  kind: "body";
  bytes: Buffer;
}
type Resource = RedirectResource | BodyResource;

/** Replace Electron net events only; provider parsing, redirect handling and digest pipes stay real. */
class MemoryRequest extends EventEmitter implements Electron.ClientRequest {
  chunkedEncoding = false;
  aborted = false;
  private readonly headers = new Map<string, string>();

  constructor(private readonly resource: Resource) {
    super();
  }

  end(_chunk?: string | Buffer, _encoding?: string, callback?: () => void): this {
    queueMicrotask(() => {
      if (this.resource.kind === "redirect") {
        this.emit("redirect", 301, "GET", this.resource.url);
      } else {
        const response = new IncomingMessage(new Socket());
        response.statusCode = 200;
        response.headers = { "content-type": "application/octet-stream" };
        this.emit("response", response);
        response.push(this.resource.bytes);
        response.push(null);
      }
      callback?.();
    });
    return this;
  }
  abort(): void {
    this.aborted = true;
    this.emit("abort");
  }
  followRedirect(): void {
    throw new Error("The real executor must reissue redirected requests");
  }
  getHeader(name: string): string {
    return this.headers.get(name) ?? "";
  }
  setHeader(name: string, value: string): void {
    this.headers.set(name, value);
  }
  removeHeader(name: string): void {
    this.headers.delete(name);
  }
  getUploadProgress(): Electron.UploadProgress {
    return { active: false, started: false, current: 0, total: 0 };
  }
  write(): void {
    throw new Error("This fixture serves GET requests only");
  }
}

/** Serve deterministic redirects without sockets, live GitHub downloads, or an Electron app. */
class MemoryElectronExecutor extends ElectronHttpExecutor {
  readonly calls: string[] = [];
  readonly requests: MemoryRequest[] = [];

  constructor(private readonly resources: Map<string, Resource>) {
    super();
  }

  override createRequest(
    options: RequestOptions,
    callback: (response: IncomingMessage) => void,
  ): MemoryRequest {
    const url = `${options.protocol}//${options.hostname}${options.path}`;
    this.calls.push(url);
    const resource = this.resources.get(url);
    if (!resource) throw new Error(`Unexpected updater request: ${url}`);
    const request = new MemoryRequest(resource);
    request.on("response", callback);
    this.requests.push(request);
    return request;
  }
}

const app: AppAdapter = {
  version: "0.11.2-preview.20",
  name: "Paseo++",
  isPackaged: true,
  appUpdateConfigPath: "unused",
  userDataPath: "unused",
  baseCachePath: "unused",
  async whenReady() {},
  relaunch() {},
  quit() {},
  onQuit() {},
};

/** Match electron-updater's platform channel name without changing packaged publish configuration. */
function channelFilename(platform: "win32" | "linux"): string {
  if (platform === "win32") return "preview.yml";
  const suffix = process.arch === "x64" ? "" : `-${process.arch}`;
  return `preview-linux${suffix}.yml`;
}

const transitions = [
  { stage: "legacy to final prerelease", installed: "0.11.2-preview.20", build: 77 },
  { stage: "legacy directly to normal release", installed: "0.11.2-preview.20", build: 80 },
  { stage: "bridge to normal release", installed: "0.11.2-preview.77", build: 80 },
];
const repositoryTransitions = (["win32", "linux"] as const).flatMap((platform) =>
  transitions.flatMap(({ stage, installed, build }) =>
    ["paseo", "paseo-plus-plus"].map((repository) => ({
      platform,
      stage,
      installed,
      build,
      repository,
    })),
  ),
);

describe("desktop GitHub repository rename bridge", () => {
  it("packages the current fork feed without requiring the legacy repository redirect", () => {
    const config = readFileSync(
      new URL("../../electron-builder.preview.yml", import.meta.url),
      "utf8",
    );
    expect(config).toContain("  owner: RyanEwen\n  repo: paseo-plus-plus\n  channel: preview\n");
    expect(config).not.toMatch(/^\s+repo: paseo$/m);
  });

  it.each(repositoryTransitions)(
    "follows the retained preview feed, repository and CDN redirects: $platform, $stage, $repository",
    async ({ platform, installed, build, repository }) => {
      const updater = new NsisUpdater(null, { ...app, version: installed });
      updater.channel = "preview";
      updater.allowPrerelease = true;
      updater.allowDowngrade = false;
      updater.logger = null;
      const version = `0.11.2-preview.${build}`;
      const tag = `v${version}`;
      const filename = platform === "win32" ? "Paseo-Debug-Setup.exe" : "Paseo-Debug.AppImage";
      const bytes = Buffer.from("verified updater fixture");
      const digest = createHash("sha512").update(bytes).digest("base64");
      const oldBase = "https://github.com/RyanEwen/paseo/releases";
      const newBase = "https://github.com/RyanEwen/paseo-plus-plus/releases";
      const oldFeed = `${oldBase}.atom`;
      const newFeed = `${newBase}.atom`;
      const oldManifest = `${oldBase}/download/${tag}/${channelFilename(platform)}`;
      const newManifest = `${newBase}/download/${tag}/${channelFilename(platform)}`;
      const oldBinary = `${oldBase}/download/${tag}/${filename}`;
      const newBinary = `${newBase}/download/${tag}/${filename}`;
      const manifestCdn =
        "https://release-assets.githubusercontent.com/github-production-release-asset/123456/manifest?sig=test";
      const binaryCdn =
        "https://release-assets.githubusercontent.com/github-production-release-asset/123456/binary?sig=test";
      // GitHub's Atom feed has no prerelease flag. Normal releases retain preview tags and manifests.
      const retainedBridge =
        build > 77
          ? `<entry><title>Paseo++ updater bridge</title><link href="${newBase}/tag/v0.11.2-preview.77"/></entry>`
          : "";
      const feed = `<feed><entry><title>Paseo++ ${build > 77 ? "Latest" : "prerelease"}</title><link href="${newBase}/tag/${tag}"/><content>Release changes</content></entry>${retainedBridge}</feed>`;
      const manifest = `version: ${version}\nfiles:\n  - url: ${filename}\n    sha512: ${digest}\n    size: ${bytes.length}\n`;
      const resources = new Map<string, Resource>([
        [oldFeed, { kind: "redirect", url: newFeed }],
        [newFeed, { kind: "body", bytes: Buffer.from(feed) }],
        [oldManifest, { kind: "redirect", url: newManifest }],
        [newManifest, { kind: "redirect", url: manifestCdn }],
        [manifestCdn, { kind: "body", bytes: Buffer.from(manifest) }],
        [oldBinary, { kind: "redirect", url: newBinary }],
        [newBinary, { kind: "redirect", url: binaryCdn }],
        [binaryCdn, { kind: "body", bytes }],
      ]);
      const executor = new MemoryElectronExecutor(resources);
      const provider = new GitHubProvider(
        {
          provider: "github",
          owner: "RyanEwen",
          repo: repository,
          channel: "preview",
        },
        updater,
        { executor, platform, isUseMultipleRangeRequest: false },
      );
      const info = await provider.getLatestVersion();
      expect(info.tag).toBe(tag);
      expect(info.version).toBe(version);
      const files = provider.resolveFiles(info);
      expect(files[0].url.href).toBe(repository === "paseo" ? oldBinary : newBinary);
      expect(files[0].info.sha512).toBe(digest);
      const directory = await mkdtemp(path.join(tmpdir(), "paseo-updater-repository-test-"));
      try {
        const target = path.join(directory, filename);
        await executor.download(files[0].url, target, {
          cancellationToken: new CancellationToken(),
          sha512: files[0].info.sha512,
        });
        expect(await readFile(target)).toEqual(bytes);
        expect(executor.calls).toEqual([
          ...(repository === "paseo" ? [oldFeed] : []),
          newFeed,
          ...(repository === "paseo" ? [oldManifest] : []),
          newManifest,
          manifestCdn,
          ...(repository === "paseo" ? [oldBinary] : []),
          newBinary,
          binaryCdn,
        ]);
        expect(executor.requests.filter((request) => request.aborted)).toHaveLength(
          repository === "paseo" ? 5 : 2,
        );
        await expect(
          executor.download(files[0].url, path.join(directory, "invalid-digest"), {
            cancellationToken: new CancellationToken(),
            sha512: createHash("sha512").update("different bytes").digest("base64"),
          }),
        ).rejects.toThrow("sha512 checksum mismatch");
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});
