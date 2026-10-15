import { lstatSync } from "node:fs";
import semver from "semver";
import { downloadForkPreview, resolveForkPreview } from "./fork-preview.js";
import { getErrorMessage } from "@getpaseo/protocol/error-utils";
import { z } from "zod";
import { execCommand } from "../../../utils/spawn.js";

import { daemonDistribution, FORK_DAEMON_PACKAGE } from "../../daemon-distribution.js";

export { FORK_DAEMON_PACKAGE };
export const PASEO_CLI_PACKAGE = daemonDistribution.cliPackage;

const NPM_PROBE_TIMEOUT_MS = 10_000;
const NPM_INSTALL_TIMEOUT_MS = 300_000;
const NPM_MAX_BUFFER_BYTES = 10 * 1024 * 1024;

const NpmGlobalListSchema = z
  .object({
    path: z.string().optional(),
    dependencies: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const NpmGlobalCliPackageSchema = z
  .object({
    version: z.string(),
    path: z.string(),
  })
  .passthrough();

const CommandErrorSchema = z
  .object({
    code: z.union([z.number(), z.string()]).optional(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
  })
  .passthrough();

export interface CommandOptions {
  timeout?: number;
  maxBuffer?: number;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface NpmGlobalPaseoInstall {
  version: string;
  packagePath: string;
  globalRootPath: string | null;
  isLinked: boolean;
}

export interface NpmGlobalPaseoCli {
  getNewerVersion(currentVersion: string): Promise<string | null>;
  inspect(options?: NpmGlobalOptions): Promise<NpmGlobalPaseoInstall>;
  installLatest(options?: NpmGlobalOptions): Promise<CommandResult>;
}

interface NpmGlobalOptions {
  prefix?: string;
}

export type CommandRunner = (
  command: string,
  args: string[],
  options?: CommandOptions,
) => Promise<CommandResult>;

async function runExternalCommand(
  command: string,
  args: string[],
  options?: CommandOptions,
): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await execCommand(command, args, {
      timeout: options?.timeout,
      maxBuffer: options?.maxBuffer,
    });
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    const parsed = CommandErrorSchema.safeParse(error);
    if (!parsed.success) {
      return { exitCode: 1, stdout: "", stderr: getErrorMessage(error) };
    }

    return {
      exitCode: typeof parsed.data.code === "number" ? parsed.data.code : 1,
      stdout: parsed.data.stdout ?? "",
      stderr: parsed.data.stderr || getErrorMessage(error),
    };
  }
}

function parseNpmGlobalPaseoInstall(
  stdout: string,
  packageName: string,
): NpmGlobalPaseoInstall | null {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(stdout);
  } catch {
    return null;
  }

  const list = NpmGlobalListSchema.safeParse(parsedJson);
  if (!list.success) {
    return null;
  }

  const rawCliPackage = list.data.dependencies?.[packageName];
  const cliPackage = NpmGlobalCliPackageSchema.safeParse(rawCliPackage);
  if (!cliPackage.success) {
    return null;
  }

  return {
    version: cliPackage.data.version,
    packagePath: cliPackage.data.path,
    globalRootPath: list.data.path ?? null,
    // npm links an install by making its node_modules entry a symlink (a junction
    // on Windows), and `npm ls --json` reports no flag for it.
    isLinked: lstatSync(cliPackage.data.path).isSymbolicLink(),
  };
}

export class DefaultNpmGlobalPaseoCli implements NpmGlobalPaseoCli {
  constructor(
    private readonly runCommand: CommandRunner = runExternalCommand,
    private readonly packageName: string = PASEO_CLI_PACKAGE,
  ) {}

  async inspect(options: NpmGlobalOptions = {}): Promise<NpmGlobalPaseoInstall> {
    const prefixArgs = options.prefix ? ["--prefix", options.prefix] : [];
    const result = await this.runCommand(
      "npm",
      ["-g", "ls", this.packageName, "--json", "--depth=0", "--long", ...prefixArgs],
      {
        timeout: NPM_PROBE_TIMEOUT_MS,
        maxBuffer: NPM_MAX_BUFFER_BYTES,
      },
    );

    if (result.exitCode !== 0 && result.stdout.trim().length === 0) {
      throw new Error(result.stderr.trim() || "npm is not available on this host");
    }

    const install = parseNpmGlobalPaseoInstall(result.stdout, this.packageName);
    if (!install) {
      throw new Error(`${this.packageName} is not installed with npm -g on this host`);
    }
    return install;
  }

  /** Use the same release channel as installation; fork builds have a durable preview counter. */
  async getNewerVersion(currentVersion: string): Promise<string | null> {
    if (this.packageName === FORK_DAEMON_PACKAGE) {
      const preview = await resolveForkPreview();
      return isNewerDaemonVersion({
        current: currentVersion,
        candidate: preview.version,
        distribution: "fork",
      })
        ? preview.version
        : null;
    }
    const result = await this.runCommand(
      "npm",
      ["view", `${this.packageName}@latest`, "version", "--json"],
      {
        timeout: NPM_PROBE_TIMEOUT_MS,
        maxBuffer: NPM_MAX_BUFFER_BYTES,
      },
    );
    if (result.exitCode !== 0)
      throw new Error(result.stderr.trim() || "Unable to check npm update");
    const version = z.string().parse(JSON.parse(result.stdout));
    return isNewerDaemonVersion({
      current: currentVersion,
      candidate: version,
      distribution: "upstream",
    })
      ? version
      : null;
  }

  async installLatest(options: NpmGlobalOptions = {}): Promise<CommandResult> {
    const prefixArgs = options.prefix ? ["--prefix", options.prefix] : [];
    if (this.packageName === FORK_DAEMON_PACKAGE) {
      const download = await downloadForkPreview();
      try {
        return await this.runCommand("npm", ["install", "-g", download.file, ...prefixArgs], {
          timeout: NPM_INSTALL_TIMEOUT_MS,
          maxBuffer: NPM_MAX_BUFFER_BYTES,
        });
      } finally {
        await download.cleanup();
      }
    }
    return this.runCommand("npm", ["install", "-g", `${this.packageName}@latest`, ...prefixArgs], {
      timeout: NPM_INSTALL_TIMEOUT_MS,
      maxBuffer: NPM_MAX_BUFFER_BYTES,
    });
  }
}

export const npmGlobalPaseoCli = new DefaultNpmGlobalPaseoCli();

interface DaemonVersionComparison {
  current: string;
  candidate: string;
  distribution: "fork" | "upstream";
}

/** Compare only known channel versions; unknown versions cannot establish update eligibility. */
export function isNewerDaemonVersion({
  current,
  candidate,
  distribution,
}: DaemonVersionComparison): boolean {
  if (distribution === "fork") {
    const pattern = /^\d+\.\d+\.\d+-preview\.(\d+)$/;
    const currentBuild = pattern.exec(current);
    const candidateBuild = pattern.exec(candidate);
    if (!currentBuild || !candidateBuild) return false;
    return BigInt(candidateBuild[1]) > BigInt(currentBuild[1]);
  }
  if (!semver.valid(current) || !semver.valid(candidate)) return false;
  return semver.gt(candidate, current);
}
