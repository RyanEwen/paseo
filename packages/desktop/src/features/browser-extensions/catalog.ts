import path from "node:path";
import { access, readFile } from "node:fs/promises";
import { writeAtomicJson } from "./atomic-json.js";
import { z } from "zod";

const EntrySchema = z.object({
  id: z.string().regex(/^[a-p]{32}$/),
  name: z.string(),
  version: z.string(),
  path: z.string(),
  source: z.enum(["store", "unpacked"]),
  enabled: z.boolean(),
});

export type BrowserExtensionEntry = z.infer<typeof EntrySchema>;
export type LoadedBrowserExtension = Pick<
  BrowserExtensionEntry,
  "id" | "name" | "version" | "path"
>;

export interface BrowserExtensionRuntime {
  isLoaded(id: string): boolean;
  load(extensionPath: string): Promise<LoadedBrowserExtension>;
  unload(id: string): void;
  uninstall(id: string): Promise<void>;
}

/** Classify managed Store folders consistently for catalog display and packaged-extension API policy. */
export function getBrowserExtensionSource(
  storePath: string,
  extensionPath: string,
): BrowserExtensionEntry["source"] {
  const relativePath = path.relative(storePath, extensionPath);
  if (relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
    return "store";
  }
  return "unpacked";
}

/** Owns saved extension choices; disabled extensions never execute during startup. */
export class BrowserExtensionCatalog {
  private entries: BrowserExtensionEntry[] = [];
  private readonly errors = new Map<string, string>();
  private queue: Promise<unknown> = Promise.resolve();

  public constructor(
    private readonly filePath: string,
    private readonly storePath: string,
    private readonly runtime: BrowserExtensionRuntime,
  ) {}

  /** Restore each enabled extension independently so one broken folder cannot block the browser. */
  public async restore(): Promise<void> {
    try {
      this.entries = z.array(EntrySchema).parse(JSON.parse(await readFile(this.filePath, "utf8")));
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }

    for (const entry of this.entries) {
      if (!entry.enabled) {
        continue;
      }
      try {
        const loaded = await this.runtime.load(entry.path);
        if (loaded.id !== entry.id) {
          this.runtime.unload(loaded.id);
          throw new Error(
            "The extension folder now contains a different extension. Remove and add it again.",
          );
        }
        Object.assign(entry, loaded);
      } catch (error) {
        this.errors.set(entry.id, error instanceof Error ? error.message : String(error));
      }
    }
  }

  /** Wait for pending installs and return snapshots including recoverable load errors. */
  public async list(): Promise<Array<BrowserExtensionEntry & { error?: string }>> {
    await this.serialize(() => this.pruneStoreRemovals());
    return this.entries.map((entry) => ({ ...entry, error: this.errors.get(entry.id) }));
  }

  /** Store-page removals bypass settings. Forget only files removed from a previously working install. */
  private async pruneStoreRemovals(): Promise<void> {
    const removedIds = new Set<string>();
    for (const entry of this.entries) {
      if (
        entry.source !== "store" ||
        !entry.enabled ||
        this.errors.has(entry.id) ||
        this.runtime.isLoaded(entry.id)
      ) {
        continue;
      }
      try {
        await access(entry.path);
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          removedIds.add(entry.id);
        } else {
          throw error;
        }
      }
    }
    if (removedIds.size > 0) {
      await this.save(this.entries.filter((entry) => !removedIds.has(entry.id)));
    }
  }

  /** Track Web Store installs and unpacked loads in the same persistent catalog. */
  public remember(extension: LoadedBrowserExtension): Promise<void> {
    return this.serialize(async () => {
      const source = getBrowserExtensionSource(this.storePath, extension.path);
      const next = this.entries.filter((entry) => entry.id !== extension.id);
      next.push({ ...extension, source, enabled: true });
      await this.save(next);
      this.errors.delete(extension.id);
    });
  }

  /** Persist disable before unloading; roll back a newly loaded extension if saving enable fails. */
  public setEnabled(id: string, enabled: boolean): Promise<void> {
    return this.serialize(async () => {
      const entry = this.requireEntry(id);
      if (enabled) {
        const loaded = await this.runtime.load(entry.path);
        if (loaded.id !== id) {
          this.runtime.unload(loaded.id);
          throw new Error("The extension identity changed. Remove and add it again.");
        }
        try {
          await this.save(
            this.entries.map((item) => (item.id === id ? { ...item, ...loaded, enabled } : item)),
          );
        } catch (error) {
          this.runtime.unload(id);
          throw error;
        }
      } else {
        await this.save(this.entries.map((item) => (item.id === id ? { ...item, enabled } : item)));
        this.runtime.unload(id);
      }
      this.errors.delete(id);
    });
  }

  /** Remove managed Store files; unpacked source folders always remain owned by the user. */
  public remove(id: string): Promise<void> {
    return this.serialize(async () => {
      const entry = this.requireEntry(id);
      if (entry.source === "store") {
        await this.runtime.uninstall(id);
      } else {
        this.runtime.unload(id);
      }
      await this.save(this.entries.filter((item) => item.id !== id));
      this.errors.delete(id);
    });
  }

  private requireEntry(id: string): BrowserExtensionEntry {
    const entry = this.entries.find((item) => item.id === id);
    if (!entry) {
      throw new Error("Extension is no longer installed. Refresh the extension list.");
    }
    return entry;
  }

  /** Keep installation events and settings mutations ordered, including after a failed operation. */
  private serialize(operation: () => Promise<void>): Promise<void> {
    const pending = this.queue.then(operation);
    this.queue = pending.catch(() => undefined);
    return pending;
  }

  private async save(entries: BrowserExtensionEntry[]): Promise<void> {
    await writeAtomicJson(this.filePath, entries);
    this.entries = entries;
  }
}
