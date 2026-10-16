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

  test.each([
    { name: "paseo-plus-plus", paseoPreview: true, home: "~/.paseo-plus-plus-desktop", port: 6790 },
    {
      name: "@getpaseo/desktop",
      paseoPreview: true,
      home: "~/.paseo-plus-plus-desktop",
      port: 6790,
    },
    {
      name: "paseo-plus-plus-debug",
      paseoDebug: true,
      home: "~/.paseo-plus-plus-debug-desktop",
      port: 6791,
    },
    {
      name: "paseo-plus-plus",
      paseoPreview: true,
      paseoDebug: true,
      home: "~/.paseo-plus-plus-debug-desktop",
      port: 6791,
    },
    { name: "paseo-plus-plus", home: "~/.paseo", port: 6767 },
    { name: "unrelated", paseoPreview: true, paseoDebug: true, home: "~/.paseo", port: 6767 },
  ])("resolves packaged $name preview=$paseoPreview debug=$paseoDebug", (fixture) => {
    const parent = mkdtempSync(path.join(tmpdir(), "paseo-desktop-distribution-"));
    try {
      const asar = path.join(parent, "resources", "app.asar");
      const server = path.join(asar, "node_modules", "@getpaseo", "server");
      mkdirSync(server, { recursive: true });
      writeFileSync(path.join(asar, "package.json"), JSON.stringify(fixture));
      writeFileSync(
        path.join(server, "package.json"),
        JSON.stringify({ name: "@getpaseo/server" }),
      );
      expect(
        resolveDaemonDistribution(
          pathToFileURL(path.join(server, "dist", "server", "server", "daemon-distribution.js"))
            .href,
        ),
      ).toEqual({
        cliPackage: "@getpaseo/cli",
        commandName: "paseo",
        defaultHome: fixture.home,
        defaultPort: fixture.port,
      });
      // A nearer standalone owner wins over desktop metadata farther up.
      writeFileSync(
        path.join(server, "package.json"),
        JSON.stringify({ name: "@ryanewen/paseo-daemon" }),
      );
      expect(
        resolveDaemonDistribution(
          pathToFileURL(path.join(server, "dist", "daemon-distribution.js")).href,
        ).cliPackage,
      ).toBe("@ryanewen/paseo-daemon");
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  test("ignores unrelated desktop flags while retaining strict owned metadata validation", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "paseo-manifest-ownership-"));
    try {
      const nested = path.join(parent, "nested");
      mkdirSync(nested);
      writeFileSync(
        path.join(parent, "package.json"),
        JSON.stringify({ name: "paseo-plus-plus", paseoPreview: true }),
      );
      const manifest = path.join(nested, "package.json");
      const moduleUrl = pathToFileURL(path.join(nested, "dist", "daemon-distribution.js")).href;
      writeFileSync(
        manifest,
        JSON.stringify({ name: "unrelated", paseoPreview: "yes", paseoDebug: 1 }),
      );
      expect(resolveDaemonDistribution(moduleUrl).defaultPort).toBe(6790);
      writeFileSync(
        manifest,
        JSON.stringify({ name: "@ryanewen/paseo-daemon", paseoPreview: "unused" }),
      );
      expect(resolveDaemonDistribution(moduleUrl).cliPackage).toBe("@ryanewen/paseo-daemon");
      writeFileSync(manifest, JSON.stringify({ name: "paseo-plus-plus", paseoPreview: "yes" }));
      expect(() => resolveDaemonDistribution(moduleUrl)).toThrow();
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
