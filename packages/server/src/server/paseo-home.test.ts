import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveDaemonDistribution } from "./daemon-distribution.js";
import { describe, expect, test } from "vitest";

import { resolvePaseoHome } from "./paseo-home.js";
describe("resolvePaseoHome", () => {
  test("resolves PASEO_HOME without creating it", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "paseo-home-parent-"));
    const paseoHome = path.join(parent, "home");
    try {
      expect(resolvePaseoHome({ PASEO_HOME: paseoHome })).toBe(paseoHome);
      expect(existsSync(paseoHome)).toBe(false);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});

describe("daemon distribution", () => {
  test("finds the fork identity through nested traced package manifests", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "paseo-distribution-"));
    try {
      const server = path.join(parent, "runtime/packages/server");
      mkdirSync(server, { recursive: true });
      writeFileSync(
        path.join(parent, "package.json"),
        JSON.stringify({ name: "@ryanewen/paseo-daemon" }),
      );
      writeFileSync(path.join(parent, "runtime/package.json"), JSON.stringify({ type: "module" }));
      writeFileSync(
        path.join(server, "package.json"),
        JSON.stringify({ name: "@getpaseo/server" }),
      );
      expect(
        resolveDaemonDistribution(
          pathToFileURL(path.join(server, "dist/server/server/daemon-distribution.js")).href,
        ),
      ).toEqual({
        cliPackage: "@ryanewen/paseo-daemon",
        commandName: "paseo-plus-plus",
        defaultHome: "~/.paseo-plus-plus",
        defaultPort: 6791,
      });
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  test("preserves upstream defaults for source and desktop runtimes", () => {
    expect(resolveDaemonDistribution(import.meta.url)).toEqual({
      cliPackage: "@getpaseo/cli",
      commandName: "paseo",
      defaultHome: "~/.paseo",
      defaultPort: 6767,
    });
  });
});
