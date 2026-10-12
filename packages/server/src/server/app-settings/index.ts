import {
  settingsFieldKey,
  settingsPathRevision,
  isSyncedSettingsPath,
} from "@getpaseo/protocol/app-settings-values";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import {
  AppSettingsSnapshotSchema,
  SYNC_APP_SETTING_KEYS,
  SYNC_SIDEBAR_SETTING_KEYS,
  type AppSettingsSnapshot,
  type AppSettingsPatch,
} from "@getpaseo/protocol/app-settings";
import { writeJsonFileAtomic } from "../atomic-file.js";

const EMPTY: AppSettingsSnapshot = {
  initialized: false,
  revision: 0,
  values: {},
  fieldRevisions: {},
};
const FORBIDDEN = new Set(["__proto__", "prototype", "constructor"]);

/** File-backed host authority. Mutations serialize, and observers see only durable writes. */
export class AppSettingsStore {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<(snapshot: AppSettingsSnapshot) => void>();
  private readonly file: string;

  constructor(
    paseoHome: string,
    private readonly write = writeJsonFileAtomic,
  ) {
    this.file = join(paseoHome, "app-settings.json");
  }

  /** Missing means uninitialized. Corruption and IO errors must never authorize seeding. */
  async read(): Promise<AppSettingsSnapshot> {
    await this.queue;
    return this.readFile();
  }

  private async readFile(): Promise<AppSettingsSnapshot> {
    try {
      return AppSettingsSnapshotSchema.parse(JSON.parse(await fs.readFile(this.file, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(EMPTY);
      throw error;
    }
  }

  subscribe(listener: (snapshot: AppSettingsSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Apply all leaves atomically or return conflicting paths without writing any of them. */
  patch(
    patches: AppSettingsPatch[],
    initialize = false,
  ): Promise<{ snapshot: AppSettingsSnapshot; conflicts: string[][] }> {
    const operation = this.queue.then(() => this.persistPatch(patches, initialize));
    this.queue = operation.catch(() => undefined);
    return operation;
  }
  private async persistPatch(
    patches: AppSettingsPatch[],
    initialize: boolean,
  ): Promise<{ snapshot: AppSettingsSnapshot; conflicts: string[][] }> {
    const snapshot = await this.readFile();
    validatePatches(patches);
    if (!snapshot.initialized && !initialize)
      throw new Error("Choose Use this device settings to initialize this host.");
    if (snapshot.initialized && initialize)
      return { snapshot, conflicts: patches.map((patch) => patch.path) };
    const conflicts = patches
      .filter((patch) => settingsPathRevision(snapshot, patch.path) !== patch.expectedRevision)
      .map((patch) => patch.path);
    if (conflicts.length) return { snapshot, conflicts };

    const next = structuredClone(snapshot);
    next.initialized = true;
    next.revision += 1;
    for (const patch of patches) {
      let target = next.values;
      for (const part of patch.path.slice(0, -1)) {
        const child = target[part];
        if (
          child !== undefined &&
          (typeof child !== "object" || child === null || Array.isArray(child))
        )
          throw new Error("Preference path is not an object");
        target[part] ??= {};
        target = target[part] as Record<string, unknown>;
      }
      target[patch.path.at(-1)!] = structuredClone(patch.value);
      next.fieldRevisions[settingsFieldKey(patch.path)] = next.revision;
    }
    if (JSON.stringify(next).length > 256_000)
      throw new Error("App settings exceed the storage limit");
    await this.write(this.file, next);
    for (const listener of this.listeners) {
      try {
        listener(structuredClone(next));
      } catch (error) {
        console.error("[AppSettings] Observer failed", error);
      }
    }
    return { snapshot: next, conflicts: [] };
  }
}

/** Restrict documents to preferences and reject unsafe paths, overlap and oversized JSON. */
function validatePatches(patches: AppSettingsPatch[]): void {
  if (!patches.length || patches.length > 256 || JSON.stringify(patches).length > 128_000)
    throw new Error("Invalid app settings patch size");
  const paths: string[][] = [];
  for (const patch of patches) {
    if (
      !["app", "sidebar"].includes(patch.path[0]!) ||
      patch.path.length < 2 ||
      patch.path.length > 8 ||
      patch.path.some((part) => FORBIDDEN.has(part))
    )
      throw new Error("Invalid app settings path");
    const allowed: readonly string[] =
      patch.path[0] === "app" ? SYNC_APP_SETTING_KEYS : SYNC_SIDEBAR_SETTING_KEYS;
    if (!allowed.includes(patch.path[1]!))
      throw new Error("Only app preferences may be synchronized");
    if (!isSyncedSettingsPath(patch.path))
      throw new Error("Usage host selection stays on the device");
    const json = JSON.stringify(patch.value);
    if (json === undefined) throw new Error("Preference must be JSON");
    // Objects are patched through leaves. Arrays are ordered preference values, replaced whole.
    if (patch.value !== null && typeof patch.value === "object" && !Array.isArray(patch.value))
      throw new Error("Patch preference objects through their leaves");
    if (
      paths.some((path) =>
        path
          .slice(0, Math.min(path.length, patch.path.length))
          .every((part, index) => part === patch.path[index]),
      )
    )
      throw new Error("Overlapping preference paths");
    paths.push(patch.path);
  }
}
