import { readFileSync, existsSync, lstatSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { downloadForkPreview } from "./fork-preview.js";
import { getErrorMessage } from "@getpaseo/protocol/error-utils";
import { z } from "zod";
import { execCommand } from "../../../utils/spawn.js";

export const FORK_DAEMON_PACKAGE = "@ryanewen/paseo-daemon";

/** Resolve the enclosing distribution, so source and Desktop builds retain their own update policy. */
function resolveCliPackage(): string {
  let directory = path.dirname(fileURLToPath(import.meta.url));
  while (path.dirname(directory) !== directory) {
    const manifest = path.join(directory, "package.json");
    if (existsSync(manifest)) {
      const parsed = z
        .object({ name: z.string().optional() })
        .parse(JSON.parse(readFileSync(manifest, "utf8")));
      if (parsed.name === FORK_DAEMON_PACKAGE) return FORK_DAEMON_PACKAGE;
    }
    directory = path.dirname(directory);
  }
  return "@getpaseo/cli";
}

export const PASEO_CLI_PACKAGE = resolveCliPackage();

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
