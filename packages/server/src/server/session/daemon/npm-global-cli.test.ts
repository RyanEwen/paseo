import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { DefaultNpmGlobalPaseoCli } from "./npm-global-cli.js";

interface CommandCall {
  command: string;
  args: string[];
  timeout?: number;
  maxBuffer?: number;
}

const globalRoot = path.join(path.sep, "global", "lib");
const globalNodeModules = path.join(globalRoot, "node_modules");
const cliPackagePath = path.join(globalNodeModules, "@getpaseo", "cli");

function npmGlobalPaseoCliJson(
  version: string,
  options?: { root?: string; packagePath?: string; resolved?: string },
): string {
  return JSON.stringify({
    name: "lib",
    path: options?.root ?? globalRoot,
    dependencies: {
      "@getpaseo/cli": {
        version,
        ...(options?.resolved ? { resolved: options.resolved } : {}),
        path: options?.packagePath ?? cliPackagePath,
      },
    },
  });
}

describe("DefaultNpmGlobalPaseoCli", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reports a global install linked to a local checkout as linked", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "paseo-npm-global-"));
    tempDirs.push(dir);
    const checkoutCli = path.join(dir, "checkout", "packages", "cli");
    const root = path.join(dir, "prefix", "lib");
    const linkedPackagePath = path.join(root, "node_modules", "@getpaseo", "cli");
    mkdirSync(checkoutCli, { recursive: true });
    mkdirSync(path.dirname(linkedPackagePath), { recursive: true });
    symlinkSync(checkoutCli, linkedPackagePath, "junction");
    // npm 7+ `ls --json --long` output for a linked install: no link flag.
    const cli = new DefaultNpmGlobalPaseoCli(async () => ({
      exitCode: 0,
      stdout: npmGlobalPaseoCliJson("0.1.15", {
        root,
        packagePath: linkedPackagePath,
        resolved: `file:${path.relative(root, checkoutCli)}`,
      }),
      stderr: "",
    }));

    await expect(cli.inspect()).resolves.toMatchObject({ isLinked: true });
  });

  test("inspects the npm global cli install with npm -g ls", async () => {
    const calls: CommandCall[] = [];
    const cli = new DefaultNpmGlobalPaseoCli(async (command, args, options) => {
      calls.push({
        command,
        args,
        timeout: options?.timeout,
        maxBuffer: options?.maxBuffer,
      });
      return { exitCode: 0, stdout: npmGlobalPaseoCliJson("0.1.15"), stderr: "" };
    });

    await expect(cli.inspect()).resolves.toEqual({
      version: "0.1.15",
      packagePath: cliPackagePath,
      globalRootPath: globalRoot,
      isLinked: false,
    });
    expect(calls).toEqual([
      {
        command: "npm",
        args: ["-g", "ls", "@getpaseo/cli", "--json", "--depth=0", "--long"],
        timeout: 10_000,
        maxBuffer: 10 * 1024 * 1024,
      },
    ]);
  });

  test("runs the global install command for the latest cli", async () => {
    const calls: CommandCall[] = [];
    const cli = new DefaultNpmGlobalPaseoCli(async (command, args, options) => {
      calls.push({
        command,
        args,
        timeout: options?.timeout,
        maxBuffer: options?.maxBuffer,
      });
      return { exitCode: 0, stdout: "changed 42 packages", stderr: "" };
    });

    await expect(cli.installLatest()).resolves.toEqual({
      exitCode: 0,
      stdout: "changed 42 packages",
      stderr: "",
    });
    expect(calls).toEqual([
      {
        command: "npm",
        args: ["install", "-g", "@getpaseo/cli@latest"],
        timeout: 300_000,
        maxBuffer: 10 * 1024 * 1024,
      },
    ]);
  });

  test("reports missing npm when npm exits without JSON", async () => {
    const cli = new DefaultNpmGlobalPaseoCli(async () => ({
      exitCode: 127,
      stdout: "",
      stderr: "npm: command not found",
    }));

    await expect(cli.inspect()).rejects.toThrow("npm: command not found");
  });

  test("reports missing global cli when npm output has no cli dependency", async () => {
    const cli = new DefaultNpmGlobalPaseoCli(async () => ({
      exitCode: 1,
      stdout: JSON.stringify({ name: "lib", path: globalRoot, dependencies: {} }),
      stderr: "missing",
    }));

    await expect(cli.inspect()).rejects.toThrow(
      "@getpaseo/cli is not installed with npm -g on this host",
    );
  });
});
