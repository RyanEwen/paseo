import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { BrowserExtensionCatalog, type LoadedBrowserExtension } from "./catalog.js";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "paseo-extensions-"));
  temporaryDirectories.push(directory);
  const storePath = path.join(directory, "store");
  const extension: LoadedBrowserExtension = {
    id: "a".repeat(32),
    name: "Fixture extension",
    version: "1.0",
    path: path.join(storePath, "a".repeat(32), "1.0"),
  };
  const loaded: string[] = [];
  const unloaded: string[] = [];
  const uninstalled: string[] = [];
  const loadedIds = new Set([extension.id]);
  let loadError: Error | null = null;
  const runtime = {
    isLoaded: (id: string) => loadedIds.has(id),
    async load(extensionPath: string) {
      loaded.push(extensionPath);
      if (loadError) {
        throw loadError;
      }
      loadedIds.add(extension.id);
      return extension;
    },
    unload(id: string) {
      loadedIds.delete(id);
      unloaded.push(id);
    },
    async uninstall(id: string) {
      loadedIds.delete(id);
      uninstalled.push(id);
    },
  };
  const filePath = path.join(directory, "catalog.json");
  const create = () => new BrowserExtensionCatalog(filePath, storePath, runtime);
  return {
    directory,
    filePath,
    extension,
    loaded,
    unloaded,
    uninstalled,
    create,
    unloadExternally: () => loadedIds.delete(extension.id),
    failLoad: () => {
      loadError = new Error("Missing extension folder");
    },
  };
}

describe("browser extension catalog", () => {
  test("Store-page removals are forgotten without reviving deleted installations", async () => {
    const f = await fixture();
    const catalog = f.create();
    await catalog.remember(f.extension);
    f.unloadExternally();
    expect(await catalog.list()).toEqual([]);
    expect(JSON.parse(await readFile(f.filePath, "utf8"))).toEqual([]);
  });
  test("Store installs survive restart and disabled extensions never load at startup", async () => {
    const f = await fixture();
    const catalog = f.create();
    await catalog.restore();
    await catalog.remember(f.extension);
    const restarted = f.create();
    await restarted.restore();
    expect(f.loaded).toEqual([f.extension.path]);
    expect(await restarted.list()).toEqual([
      { ...f.extension, source: "store", enabled: true, error: undefined },
    ]);

    await restarted.setEnabled(f.extension.id, false);
    expect(f.unloaded).toEqual([f.extension.id]);
    await f.create().restore();
    expect(f.loaded).toEqual([f.extension.path]);
    expect(JSON.parse(await readFile(f.filePath, "utf8"))[0].enabled).toBe(false);
  });

  test("failed startup loads stay visible with an actionable error", async () => {
    const f = await fixture();
    await f.create().remember(f.extension);
    f.failLoad();
    const restarted = f.create();
    await restarted.restore();
    expect(await restarted.list()).toEqual([
      { ...f.extension, source: "store", enabled: true, error: "Missing extension folder" },
    ]);
  });

  test("failed enable retains the saved disabled choice and future actions still work", async () => {
    const f = await fixture();
    const catalog = f.create();
    await catalog.remember(f.extension);
    await catalog.setEnabled(f.extension.id, false);
    f.failLoad();
    await expect(catalog.setEnabled(f.extension.id, true)).rejects.toThrow(
      "Missing extension folder",
    );
    expect((await catalog.list())[0].enabled).toBe(false);
    await catalog.remove(f.extension.id);
    expect(await catalog.list()).toEqual([]);
    expect(f.uninstalled).toEqual([f.extension.id]);
  });

  test("removing unpacked extensions never deletes the user's source folder", async () => {
    const f = await fixture();
    const extension = { ...f.extension, path: path.join(f.directory, "user-extension") };
    const catalog = f.create();
    await catalog.remember(extension);
    expect((await catalog.list())[0].source).toBe("unpacked");
    await catalog.remove(extension.id);
    expect(f.unloaded).toEqual([extension.id]);
    expect(f.uninstalled).toEqual([]);
    expect(await catalog.list()).toEqual([]);
  });

  test("unreadable catalogs are preserved instead of replaced with an empty list", async () => {
    const f = await fixture();
    await writeFile(f.filePath, "broken JSON");
    await expect(f.create().restore()).rejects.toThrow();
    expect(await readFile(f.filePath, "utf8")).toBe("broken JSON");
  });
});
