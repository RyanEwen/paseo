import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveDesktopDistribution, resolveDesktopUpdateChannel } from "../distribution.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function writeExecutable(filePath: string, contents: string): void {
  writeFileSync(filePath, contents, "utf8");
  chmodSync(filePath, 0o755);
}

function createFakeMacBundle(options: { includeHelper: boolean }): {
  root: string;
  shimPath: string;
} {
  const root = mkdtempSync(join(tmpdir(), "paseo-cli-shim-test-"));
  const appPath = join(root, "Paseo.app");
  const contentsPath = join(appPath, "Contents");
  const resourcesPath = join(contentsPath, "Resources");
  const shimPath = join(resourcesPath, "bin", "paseo");
  const mainPath = join(contentsPath, "MacOS", "Paseo");
  const helperPath = join(
    contentsPath,
    "Frameworks",
    "Paseo Helper.app",
    "Contents",
    "MacOS",
    "Paseo Helper",
  );

  mkdirSync(dirname(shimPath), { recursive: true });
  writeFileSync(join(resourcesPath, "paseo-executable-name"), "Paseo\n");
  mkdirSync(dirname(mainPath), { recursive: true });
  copyFileSync(join(packageRoot, "bin", "paseo"), shimPath);
  chmodSync(shimPath, 0o755);

  writeExecutable(mainPath, "#!/bin/sh\necho main-executable\n");

  if (options.includeHelper) {
    mkdirSync(dirname(helperPath), { recursive: true });
    writeExecutable(
      helperPath,
      [
        "#!/bin/sh",
        'printf "helper env=%s/%s cli=%s\\n" "$ELECTRON_RUN_AS_NODE" "$PASEO_NODE_ENV" "$PASEO_CLI"',
        'printf "args=%s\\n" "$*"',
        "",
      ].join("\n"),
    );
  }

  return { root, shimPath };
}

describe("desktop packaging", () => {
  it("keeps fork settings and the local daemon isolated while pinning preview updates", () => {
    expect(resolveDesktopDistribution({ paseoPreview: true })).toEqual({
      isPreview: true,
      appName: "Paseo Debug",
      daemonHomeName: ".paseo-debug",
      daemonListen: "127.0.0.1:6790",
    });
    expect(resolveDesktopUpdateChannel(true, "stable")).toEqual({
      allowPrerelease: true,
      channel: "preview",
    });
    expect(resolveDesktopUpdateChannel(true, "beta")).toEqual({
      allowPrerelease: true,
      channel: "preview",
    });
    expect(resolveDesktopUpdateChannel(false, "stable")).toEqual({
      allowPrerelease: false,
      channel: "latest",
    });
    expect(resolveDesktopUpdateChannel(false, "beta")).toEqual({
      allowPrerelease: true,
      channel: "beta",
    });
  });

  it("runs the bundled preview CLI against its own daemon and honors explicit overrides", () => {
    const root = mkdtempSync(join(tmpdir(), "paseo-preview-cli-"));
    try {
      const resources = join(root, "resources");
      const isWindows = process.platform === "win32";
      const shimName = isWindows ? "paseo.cmd" : "paseo";
      const shim = join(resources, "bin", shimName);
      mkdirSync(dirname(shim), { recursive: true });
      copyFileSync(join(packageRoot, "bin", shimName), shim);
      chmodSync(shim, 0o755);
      writeFileSync(join(resources, "paseo-executable-name"), "Paseo Debug\n");
      writeFileSync(join(resources, "paseo-daemon-home-name"), ".paseo-debug\n");
      writeFileSync(join(resources, "paseo-daemon-listen"), "127.0.0.1:6790\n");
      const printEnvironment =
        "console.log(JSON.stringify([process.env.PASEO_HOME, process.env.PASEO_LISTEN]));";
      if (isWindows) {
        // Use a real PE with a tiny runner so this exercises cmd.exe's bundled shim.
        copyFileSync(process.execPath, join(root, "Paseo Debug.exe"));
        const runner = join(
          resources,
          "app.asar.unpacked",
          "dist",
          "daemon",
          "node-entrypoint-runner.js",
        );
        mkdirSync(dirname(runner), { recursive: true });
        writeFileSync(runner, printEnvironment);
      } else {
        writeExecutable(
          join(root, "Paseo Debug.bin"),
          `#!${process.execPath}\n${printEnvironment}\n`,
        );
      }
      const env = { ...process.env, HOME: root, USERPROFILE: root };
      delete env.PASEO_HOME;
      delete env.PASEO_LISTEN;
      const command = isWindows ? (process.env.ComSpec ?? "cmd.exe") : "sh";
      const args = isWindows ? ["/d", "/s", "/c", `""${shim}" ls"`] : [shim, "ls"];
      const defaults = spawnSync(command, args, { encoding: "utf8", env });
      expect(defaults.status, defaults.stderr).toBe(0);
      expect(JSON.parse(defaults.stdout)).toEqual([join(root, ".paseo-debug"), "127.0.0.1:6790"]);
      const overridden = spawnSync(command, args, {
        encoding: "utf8",
        env: { ...env, PASEO_HOME: "/custom-preview", PASEO_LISTEN: "127.0.0.1:12345" },
      });
      expect(overridden.status, overridden.stderr).toBe(0);
      expect(JSON.parse(overridden.stdout)).toEqual(["/custom-preview", "127.0.0.1:12345"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("uses an Electron runtime whose Squirrel handoff explicitly wakes ShipIt", () => {
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
      devDependencies?: Record<string, string>;
    };
    const electronVersion = pkg.devDependencies?.electron ?? "0.0.0";
    const electronMajor = Number(electronVersion.split(".")[0]);

    expect(electronMajor).toBeGreaterThanOrEqual(44);
  });

  it("requires macOS 13 or newer in the packaged application", () => {
    const config = readFileSync(join(packageRoot, "electron-builder.yml"), "utf8");

    expect(config).toContain('minimumSystemVersion: "13.0.0"');
  });

  it("unpacks server zsh shell integration files for external shells", () => {
    const config = readFileSync(join(packageRoot, "electron-builder.yml"), "utf8");

    expect(config).toContain(
      "node_modules/@getpaseo/server/dist/server/terminal/shell-integration/**/*",
    );
    expect(config).not.toContain(
      "node_modules/@getpaseo/server/dist/src/terminal/shell-integration/**/*",
    );
  });

  it("excludes package debug/source files from the packaged app", () => {
    const config = readFileSync(join(packageRoot, "electron-builder.yml"), "utf8");

    expect(config).toContain("!**/*.map");
    expect(config).toContain("!node_modules/@getpaseo/*/src/**");
    expect(config).toContain("!node_modules/@getpaseo/**/*.test.*");
    expect(config).toContain("!node_modules/@getpaseo/**/*.spec.*");
  });

  it("excludes the bundled daemon web UI from the packaged app", () => {
    const config = readFileSync(join(packageRoot, "electron-builder.yml"), "utf8");

    expect(config).toContain("!node_modules/@getpaseo/server/dist/server/web-ui/**");
  });

  it("uses the server skill catalog without a duplicate desktop resource", () => {
    const config = readFileSync(join(packageRoot, "electron-builder.yml"), "utf8");
    const serverPackage = readFileSync(join(packageRoot, "..", "server", "package.json"), "utf8");
    const runtimeTrace = readFileSync(
      join(packageRoot, "..", "..", "scripts", "trace-daemon.mjs"),
      "utf8",
    );

    expect(config).not.toContain("from: ../../skills");
    expect(serverPackage).toContain("fs.rmSync('dist/server/skills',{recursive:true,force:true})");
    expect(serverPackage).toContain("fs.cpSync('../../skills','dist/server/skills'");
    expect(runtimeTrace).toContain('"packages/server/dist/server/skills/**"');
  });

  it("registers Paseo agent links with the operating system", () => {
    const config = readFileSync(join(packageRoot, "electron-builder.yml"), "utf8");

    expect(config).toContain("name: Paseo agent link");
    expect(config).toContain("- paseo");
  });

  // electron-builder packs production dependencies declared in package.json into
  // app.asar. Runtime code in runtime-paths.ts and bin/paseo dynamically resolves
  // these workspace packages by string, so static analysis (TypeScript, Knip) cannot
  // see the link. If a runtime-required workspace dep is dropped from
  // dependencies, the build still succeeds but ships a broken bundle. This
  // assertion is the safety net.
  it("declares all workspace packages required at runtime", () => {
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const deps = pkg.dependencies ?? {};

    for (const required of ["@getpaseo/cli", "@getpaseo/server"]) {
      expect(deps[required], `${required} must be declared in dependencies`).toBe("*");
    }
  });

  it("launches the packaged macOS CLI through Helper instead of the main app executable", () => {
    if (process.platform === "win32") return;

    const bundle = createFakeMacBundle({ includeHelper: true });
    try {
      const result = spawnSync(bundle.shimPath, ["--version"], { encoding: "utf8" });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain(`helper env=1/production cli=${bundle.shimPath}`);
      expect(result.stdout).toContain("node-entrypoint-runner.js");
      expect(result.stdout).toContain("node-script");
      expect(result.stdout).toContain("@getpaseo/cli/dist/index.js");
      expect(result.stdout).toContain("--version");
      expect(result.stdout).not.toContain("main-executable");
    } finally {
      rmSync(bundle.root, { recursive: true, force: true });
    }
  });

  it("fails packaged macOS CLI startup when Helper is missing", () => {
    if (process.platform === "win32") return;

    const bundle = createFakeMacBundle({ includeHelper: false });
    try {
      const result = spawnSync(bundle.shimPath, ["--version"], { encoding: "utf8" });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Bundled Paseo Helper executable not found");
      expect(result.stdout).not.toContain("main-executable");
    } finally {
      rmSync(bundle.root, { recursive: true, force: true });
    }
  });
});

it("installs the Linux helper as root-owned 4755 regardless of root's namespace access", () => {
  const config = readFileSync(join(packageRoot, "electron-builder.yml"), "utf8");
  expect(config).toContain("afterInstall: scripts/linux-sandbox/after-install.tpl");
  const installer = readFileSync(
    join(packageRoot, "scripts/linux-sandbox/after-install.tpl"),
    "utf8",
  );
  expect(installer).not.toContain("unshare");
  expect(installer).toContain("chown root:root '/opt/${sanitizedProductName}/chrome-sandbox'");
  expect(installer).toContain("chmod 4755 '/opt/${sanitizedProductName}/chrome-sandbox'");
  expect(installer).not.toContain("chmod 0755");
});
