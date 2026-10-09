import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const FORK_DAEMON_PACKAGE = "@ryanewen/paseo-daemon";

const manifestSchema = z.object({ name: z.string().optional() });

const upstreamDistribution = {
  cliPackage: "@getpaseo/cli",
  commandName: "paseo",
  defaultHome: "~/.paseo",
  defaultPort: 6767,
} as const;

const forkDistribution = {
  cliPackage: FORK_DAEMON_PACKAGE,
  commandName: "paseo-plus-plus",
  defaultHome: "~/.paseo-plus-plus",
  defaultPort: 6791,
} as const;

/** Resolve installed identity from the enclosing package, independent of launch environment overrides. */
export function resolveDaemonDistribution(moduleUrl: string) {
  let directory = path.dirname(fileURLToPath(moduleUrl));
  while (path.dirname(directory) !== directory) {
    const manifest = path.join(directory, "package.json");
    if (existsSync(manifest)) {
      const parsed = manifestSchema.parse(JSON.parse(readFileSync(manifest, "utf8")));
      if (parsed.name === FORK_DAEMON_PACKAGE) {
        return forkDistribution;
      }
    }
    directory = path.dirname(directory);
  }

  return upstreamDistribution;
}

export const daemonDistribution = resolveDaemonDistribution(import.meta.url);
