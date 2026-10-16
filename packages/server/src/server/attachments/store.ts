import { constants, type Dir, type Stats, type StatsFs } from "node:fs";
import { open, mkdir, lstat, link, unlink, opendir, statfs } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  AttachmentReferenceSchema,
  AttachmentOwnerSchema,
  AttachmentIdSchema,
  type AttachmentReference,
} from "@getpaseo/protocol/attachments";
import {
  admitProviderImage,
  PROVIDER_IMAGE_MAX_BYTES,
} from "../agent/providers/provider-image-output.js";
import { withAttachmentResource } from "./io.js";

export interface AttachmentFileSystem {
  open: typeof open;
  mkdir(directory: string, options: { recursive?: boolean; mode: number }): Promise<void>;
  lstat(file: string): Promise<Stats>;
  link(source: string, destination: string): Promise<void>;
  unlink(file: string): Promise<void>;
  opendir(directory: string): Promise<Dir>;
  statfs(directory: string): Promise<StatsFs>;
}
export const attachmentFileSystem: AttachmentFileSystem = Object.freeze({
  open,
  mkdir: async (directory: string, options: { recursive?: boolean; mode: number }) => {
    await mkdir(directory, options);
  },
  lstat,
  link,
  unlink,
  opendir,
  statfs,
});

export const ATTACHMENT_LIMITS = {
  globalBytes: 1024 * 1024 * 1024,
  ownerBytes: 256 * 1024 * 1024,
  globalReferences: 4096,
  ownerReferences: 512,
  blobFiles: 4096,
  referenceBytes: 2048,
  entryCharge: 4096,
  metadataBytes: 32 * 1024 * 1024,
  freeBytes: 512 * 1024 * 1024,
  scanEntries: 16384,
  globalReads: 4,
  sessionReads: 2,
  chunkBytes: 64 * 1024,
  readIdleMs: 30_000,
  readTotalMs: 300_000,
  closeMs: 30_000,
};
export type AttachmentLimits = typeof ATTACHMENT_LIMITS;
export class AttachmentStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentStoreError";
  }
}
function errno(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
interface OwnerIdentity {
  token: string;
  dev: number;
  ino: number;
  handle: FileHandle;
}
export interface AttachmentWriter {
  commit(
    image: { data: string; mimeType: string },
    signal?: AbortSignal,
  ): Promise<AttachmentReference>;
  release(): Promise<void>;
}
export interface AttachmentReadLease {
  reference: AttachmentReference;
  chunks(signal: AbortSignal): AsyncGenerator<Uint8Array>;
  close(): Promise<void>;
  dispatchSend(operation: () => Promise<void>): Promise<void>;
  readonly settled: Promise<void>;
}
interface OwnerUsage {
  bytes: number;
  references: number;
  hashes: Set<string>;
}

/** Append-only originals. No archive cleanup, stale-lock recovery or committed-file deletion. */
export class AttachmentStore {
  private readonly directory: string;
  private owner: OwnerIdentity | null = null;
  private readonly references = new Map<string, AttachmentReference>();
  private readonly owners = new Map<string, OwnerUsage>();
  private chargedBytes = 0;
  private metadataBytes = 0;
  private blobFiles = 0;
  private referenceFiles = 0;
  private writeFailure: string | null = "Attachment storage is initializing.";
  private activeWrite: { done: Promise<void>; finish(): void } | null = null;
  private closing = false;
  private closePromise: Promise<void> | null = null;
  private reads = 0;
  private readonly readsBySession = new Map<object, number>();
  private readonly readClosers = new Set<() => Promise<void>>();
  private refreshPromise: Promise<void> | null = null;

  private constructor(
    home: string,
    readonly limits: AttachmentLimits,
    private readonly io: AttachmentFileSystem,
  ) {
    this.directory = path.join(home, "attachments");
  }
  static async create(
    home: string,
    limits: AttachmentLimits = ATTACHMENT_LIMITS,
    io: AttachmentFileSystem = attachmentFileSystem,
  ): Promise<AttachmentStore> {
    const store = new AttachmentStore(home, limits, io);
    await store.initialize();
    return store;
  }
  get writable(): boolean {
    return this.owner !== null && this.writeFailure === null && !this.closing;
  }
  get writeError(): string | null {
    return this.closing ? "Attachment storage is closing." : this.writeFailure;
  }

  private async initialize(): Promise<void> {
    try {
      try {
        const existing = await this.io.lstat(this.directory);
        if (!existing.isDirectory() || existing.isSymbolicLink())
          throw new AttachmentStoreError("Attachment storage directory is unsafe.");
      } catch (error) {
        if (!errno(error, "ENOENT")) throw error;
        await this.io.mkdir(path.dirname(this.directory), { recursive: true, mode: 0o700 });
        await this.io.mkdir(this.directory, { mode: 0o700 });
        await this.syncDirectory(path.dirname(this.directory));
      }
      let handle: FileHandle;
      try {
        handle = await this.io.open(path.join(this.directory, "writer"), "wx", 0o600);
      } catch (error) {
        if (errno(error, "EEXIST"))
          this.writeFailure =
            "Attachment writes are disabled because exclusive storage ownership is unavailable. Existing originals may still be readable.";
        else
          this.writeFailure =
            "Attachment writes are disabled because storage ownership could not be acquired.";
        await this.recover(false);
        return;
      }
      let stats;
      try {
        stats = await handle.stat();
      } catch (error) {
        await withAttachmentResource(
          () => Promise.reject(error),
          () => handle.close(),
        );
        return;
      }
      this.owner = { token: randomUUID(), dev: stats.dev, ino: stats.ino, handle };
      await handle.writeFile(this.owner.token, "utf8");
      await handle.sync();
      await this.syncDirectory(this.directory);
      for (const name of ["blobs", "references", "staging"]) {
        const directory = path.join(this.directory, name);
        try {
          await this.io.mkdir(directory, { mode: 0o700 });
        } catch (error) {
          if (!errno(error, "EEXIST")) throw error;
        }
        const directoryStats = await this.io.lstat(directory);
        if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink())
          throw new AttachmentStoreError("Attachment directory is unsafe.");
      }
      await this.syncDirectory(this.directory);
      this.writeFailure = null;
      await this.recover(true);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      this.writeFailure =
        "Attachment writes are disabled because storage initialization or accounting failed. Existing originals may still be readable.";
      // Keep the acquired identity until close; a partially written token never grants removal.
    }
  }

  private async safeOpen(file: string, signal?: AbortSignal): Promise<FileHandle> {
    signal?.throwIfAborted();
    const root = await this.io.lstat(this.directory);
    signal?.throwIfAborted();
    if (!root.isDirectory() || root.isSymbolicLink())
      throw new AttachmentStoreError("Attachment storage root is unsafe.");
    const directory = await this.io.lstat(path.dirname(file));
    signal?.throwIfAborted();
    if (!directory.isDirectory() || directory.isSymbolicLink())
      throw new AttachmentStoreError("Attachment directory is unsafe.");
    const entry = await this.io.lstat(file);
    signal?.throwIfAborted();
    if (!entry.isFile() || entry.isSymbolicLink())
      throw new AttachmentStoreError("Original attachment is unavailable or unsafe.");
    const flags =
      process.platform === "win32" ? constants.O_RDONLY : constants.O_RDONLY | constants.O_NOFOLLOW;
    const handle = await this.io.open(file, flags);
    try {
      signal?.throwIfAborted();
      const actual = await handle.stat();
      signal?.throwIfAborted();
      if (!actual.isFile() || actual.dev !== entry.dev || actual.ino !== entry.ino)
        throw new AttachmentStoreError("Original attachment changed while opening.");
      return handle;
    } catch (error) {
      return withAttachmentResource(
        () => Promise.reject(error),
        () => handle.close(),
      );
    }
  }
  private async readReference(id: string, signal?: AbortSignal): Promise<AttachmentReference> {
    AttachmentIdSchema.parse(id);
    const handle = await this.safeOpen(
      path.join(this.directory, "references", `${id}.json`),
      signal,
    );
    return withAttachmentResource(
      async () => {
        const stats = await handle.stat();
        signal?.throwIfAborted();
        if (stats.size > this.limits.referenceBytes)
          throw new AttachmentStoreError("Attachment reference is corrupt.");
        const reference = AttachmentReferenceSchema.parse(
          JSON.parse(await handle.readFile("utf8")),
        );
        signal?.throwIfAborted();
        if (reference.id !== id)
          throw new AttachmentStoreError("Attachment reference identity is corrupt.");
        return reference;
      },
      () => handle.close(),
    );
  }
  private async recover(writer: boolean): Promise<void> {
    const references = new Map<string, AttachmentReference>();
    const owners = new Map<string, OwnerUsage>();
    let charged = 0;
    let metadata = 0;
    let blobs = 0;
    let refs = 0;
    let entries = 0;
    let uncertain = false;
    const walk = async (directory: string): Promise<void> => {
      let stream;
      try {
        stream = await this.io.opendir(directory);
      } catch (error) {
        if (errno(error, "ENOENT")) return;
        throw error;
      }
      for await (const entry of stream) {
        if (++entries > this.limits.scanEntries)
          throw new AttachmentStoreError("Attachment accounting scan limit exceeded.");
        const file = path.join(directory, entry.name);
        const info = await this.io.lstat(file);
        if (info.isSymbolicLink()) {
          uncertain = true;
          continue;
        }
        if (info.isDirectory()) {
          await walk(file);
          continue;
        }
        metadata += this.limits.entryCharge;
        if (directory === path.join(this.directory, "references")) {
          refs++;
          try {
            if (!/^att_[0-9a-f-]{36}\.json$/.test(entry.name))
              throw new AttachmentStoreError("Unknown reference entry.");
            const id = entry.name.slice(0, -5);
            const reference = await this.readReference(id);
            references.set(id, reference);
            const usage = owners.get(reference.agentId) ?? {
              bytes: 0,
              references: 0,
              hashes: new Set<string>(),
            };
            usage.references++;
            if (!usage.hashes.has(reference.sha256)) {
              usage.bytes += reference.byteLength;
              usage.hashes.add(reference.sha256);
            }
            owners.set(reference.agentId, usage);
          } catch {
            uncertain = true;
          }
        } else if (file !== path.join(this.directory, "writer")) {
          charged += info.size;
          blobs++;
          if (!info.isFile()) uncertain = true;
        }
      }
    };
    await walk(this.directory);
    this.references.clear();
    for (const [id, ref] of references) this.references.set(id, ref);
    this.owners.clear();
    for (const [id, usage] of owners) this.owners.set(id, usage);
    this.chargedBytes = charged + metadata;
    this.metadataBytes = metadata;
    this.blobFiles = blobs;
    this.referenceFiles = refs;
    if (writer && uncertain)
      this.writeFailure =
        "Attachment writes are disabled because recovered accounting is uncertain. Originals have been retained.";
  }

  async reserve(
    owner: { agentId: string; workspaceId?: string },
    signal?: AbortSignal,
  ): Promise<AttachmentWriter> {
    AttachmentOwnerSchema.parse(owner.agentId);
    if (
      owner.workspaceId !== undefined &&
      (owner.workspaceId.length < 1 || owner.workspaceId.length > 256)
    )
      throw new AttachmentStoreError("Attachment workspace provenance is invalid.");
    signal?.throwIfAborted();
    if (!this.writable)
      throw new AttachmentStoreError(this.writeError ?? "Attachment writes are unavailable.");
    if (this.activeWrite)
      throw new AttachmentStoreError("Attachment storage is busy. No screenshot was captured.");
    const usage = this.owners.get(owner.agentId);
    const reservation = PROVIDER_IMAGE_MAX_BYTES + 2 * this.limits.entryCharge;
    const overBytes =
      this.chargedBytes + reservation > this.limits.globalBytes ||
      (usage?.bytes ?? 0) + PROVIDER_IMAGE_MAX_BYTES > this.limits.ownerBytes;
    const overCount =
      this.referenceFiles + 1 > this.limits.globalReferences ||
      (usage?.references ?? 0) + 1 > this.limits.ownerReferences ||
      this.blobFiles + 1 > this.limits.blobFiles;
    if (
      overBytes ||
      overCount ||
      this.metadataBytes + 2 * this.limits.entryCharge > this.limits.metadataBytes
    )
      throw new AttachmentStoreError(
        "Attachment storage quota cannot reserve this screenshot. No screenshot was captured.",
      );
    let finish = () => {};
    const active = {
      done: new Promise<void>((resolve) => {
        finish = resolve;
      }),
      finish: () => finish(),
    };
    this.activeWrite = active;
    let operation: Promise<AttachmentReference> | null = null;
    let released = false;
    const release = async () => {
      if (operation) await operation.catch(() => {});
      if (released) return;
      released = true;
      if (this.activeWrite === active) this.activeWrite = null;
      active.finish();
    };
    try {
      const free = await this.io.statfs(this.directory);
      if (free.bavail * free.bsize < this.limits.freeBytes + reservation)
        throw new AttachmentStoreError("Attachment storage has insufficient free disk space.");
      this.assertWriteActive(signal);
      return {
        commit: (image, commitSignal) => {
          if (released || operation)
            return Promise.reject(
              new AttachmentStoreError("Attachment reservation is no longer available."),
            );
          const combined =
            signal && commitSignal
              ? AbortSignal.any([signal, commitSignal])
              : (signal ?? commitSignal);
          operation = this.commit(owner, image, combined);
          return operation;
        },
        release,
      };
    } catch (error) {
      await release();
      throw error;
    }
  }
  private assertWriteActive(signal?: AbortSignal): void {
    signal?.throwIfAborted();
    if (!this.writable)
      throw new AttachmentStoreError(this.writeError ?? "Attachment writes are unavailable.");
  }
  private async syncDirectory(directory: string): Promise<void> {
    // Windows does not support directory fsync through Node. File data is still synced.
    if (process.platform === "win32") return;
    const handle = await this.io.open(directory, "r");
    await withAttachmentResource(
      () => handle.sync(),
      () => handle.close(),
    );
  }
  private async stage(bytes: Uint8Array): Promise<string> {
    const file = path.join(this.directory, "staging", randomUUID());
    const handle = await this.io.open(file, "wx", 0o600);
    await withAttachmentResource(
      async () => {
        await handle.writeFile(bytes);
        await handle.sync();
      },
      () => handle.close(),
    );
    return file;
  }
  private async verifyBlob(hash: string, size: number): Promise<void> {
    const handle = await this.safeOpen(path.join(this.directory, "blobs", hash));
    await withAttachmentResource(
      async () => {
        if ((await handle.stat()).size !== size)
          throw new AttachmentStoreError("Original attachment is unavailable or corrupt.");
        const digest = createHash("sha256");
        const buffer = Buffer.alloc(this.limits.chunkBytes);
        let offset = 0;
        while (offset < size) {
          const { bytesRead } = await handle.read(
            buffer,
            0,
            Math.min(buffer.length, size - offset),
            offset,
          );
          if (!bytesRead) throw new AttachmentStoreError("Original attachment is incomplete.");
          digest.update(buffer.subarray(0, bytesRead));
          offset += bytesRead;
        }
        if (digest.digest("hex") !== hash)
          throw new AttachmentStoreError("Original attachment hash is corrupt.");
      },
      () => handle.close(),
    );
  }
  private async commit(
    owner: { agentId: string; workspaceId?: string },
    image: { data: string; mimeType: string },
    signal?: AbortSignal,
  ): Promise<AttachmentReference> {
    const staging = new Set<string>();
    let result: { reference: AttachmentReference } | { failure: unknown };
    try {
      result = { reference: await this.publish(owner, image, staging, signal) };
    } catch (failure) {
      result = { failure };
    }
    let cleanupFailure: { failure: unknown } | undefined;
    try {
      await this.cleanupPublication(staging);
    } catch (failure) {
      cleanupFailure = { failure };
    }
    if (cleanupFailure) {
      if ("failure" in result)
        throw new AggregateError(
          [result.failure, cleanupFailure.failure],
          "Attachment publication failed and cleanup also failed.",
          { cause: result.failure },
        );
      throw cleanupFailure.failure;
    }
    if ("failure" in result) throw result.failure;
    return result.reference;
  }
  private async publish(
    owner: { agentId: string; workspaceId?: string },
    image: { data: string; mimeType: string },
    staging: Set<string>,
    signal?: AbortSignal,
  ): Promise<AttachmentReference> {
    this.assertWriteActive(signal);
    const admitted = admitProviderImage(image);
    const previous = [...this.references.values()].find(
      (ref) =>
        ref.agentId === owner.agentId &&
        ref.sha256 === admitted.sha256 &&
        ref.mimeType === admitted.mimeType,
    );
    const blob = path.join(this.directory, "blobs", admitted.sha256);
    try {
      await this.verifyBlob(admitted.sha256, admitted.bytes.length);
    } catch (error) {
      if (!errno(error, "ENOENT")) throw error;
      const temporary = await this.stage(admitted.bytes);
      staging.add(temporary);
      this.assertWriteActive(signal);
      await this.io.link(temporary, blob);
      await this.syncDirectory(path.dirname(blob));
    }
    if (previous) return previous;
    this.assertWriteActive(signal);
    const reference = AttachmentReferenceSchema.parse({
      id: `att_${randomUUID()}`,
      ...owner,
      sha256: admitted.sha256,
      byteLength: admitted.bytes.length,
      mimeType: admitted.mimeType,
      createdAt: new Date().toISOString(),
    });
    const metadata = Buffer.from(JSON.stringify(reference));
    if (metadata.length > this.limits.referenceBytes)
      throw new AttachmentStoreError("Attachment reference metadata exceeds its limit.");
    const temporary = await this.stage(metadata);
    staging.add(temporary);
    this.assertWriteActive(signal);
    await this.io.link(temporary, path.join(this.directory, "references", `${reference.id}.json`));
    await this.syncDirectory(path.join(this.directory, "references"));
    // Reference publication is the commit point. Cancellation never deletes it.
    return reference;
  }
  private async cleanupPublication(staging: Set<string>): Promise<void> {
    const failures: unknown[] = [];
    for (const file of staging) {
      try {
        await this.io.unlink(file);
      } catch (error) {
        failures.push(error);
      }
    }
    try {
      await this.recover(true);
    } catch (error) {
      this.writeFailure =
        "Attachment writes are disabled because accounting could not be established.";
      failures.push(error);
    }
    if (failures.length)
      throw new AggregateError(
        failures,
        "Attachment cleanup or accounting failed; original artifacts have been retained.",
      );
  }

  async list(
    agentId: string,
    after?: string,
    limit = 50,
  ): Promise<{ references: AttachmentReference[]; next: string | null }> {
    AttachmentOwnerSchema.parse(agentId);
    if (!this.writable) {
      this.refreshPromise ??= this.recover(false).finally(() => {
        this.refreshPromise = null;
      });
      await this.refreshPromise;
    }
    const refs = [...this.references.values()]
      .filter((ref) => ref.agentId === agentId && (!after || ref.id > after))
      .sort((a, b) => a.id.localeCompare(b.id));
    const page = refs.slice(0, Math.min(50, Math.max(1, limit)));
    return { references: page, next: refs.length > page.length ? page[page.length - 1].id : null };
  }
  async get(
    agentId: string,
    referenceId: string,
    session: object = this,
    signal?: AbortSignal,
  ): Promise<AttachmentReference> {
    // Metadata confirms a bounded reference and safe opened blob size, not its content hash.
    const lease = await this.openRead(agentId, referenceId, session, signal);
    return withAttachmentResource(
      async () => {
        signal?.throwIfAborted();
        return lease.reference;
      },
      () => lease.close(),
    );
  }
  async openRead(
    agentId: string,
    referenceId: string,
    session: object,
    signal?: AbortSignal,
  ): Promise<AttachmentReadLease> {
    signal?.throwIfAborted();
    if (
      this.closing ||
      this.reads >= this.limits.globalReads ||
      (this.readsBySession.get(session) ?? 0) >= this.limits.sessionReads
    )
      throw new AttachmentStoreError("Attachment original transfer is busy or closing.");
    this.reads++;
    this.readsBySession.set(session, (this.readsBySession.get(session) ?? 0) + 1);
    let handle: FileHandle | null = null;
    let closed = false;
    let fileCloseSettled = false;
    let released = false;
    let pendingSends = 0;
    let closePromise: Promise<void> | null = null;
    let opened = () => {};
    const opening = new Promise<void>((resolve) => {
      opened = resolve;
    });
    let release = () => {};
    const settled = new Promise<void>((resolve) => {
      release = resolve;
    });
    const releaseIfDrained = () => {
      if (released || !fileCloseSettled || pendingSends) return;
      released = true;
      this.reads--;
      const count = (this.readsBySession.get(session) ?? 1) - 1;
      if (count) this.readsBySession.set(session, count);
      else this.readsBySession.delete(session);
      release();
    };
    const dispatchSend = (operation: () => Promise<void>) => {
      if (closed) throw new AttachmentStoreError("Original transfer is closed.");
      pendingSends++;
      const pending = Promise.resolve().then(() => {
        if (closed) throw new AttachmentStoreError("Original transfer is closed.");
        return operation();
      });
      // Both outcomes are observed. Caller timeout never supplies acknowledgement.
      void pending.then(
        () => {
          pendingSends--;
          return releaseIfDrained();
        },
        () => {
          pendingSends--;
          return releaseIfDrained();
        },
      );
      return pending;
    };
    const close = () => {
      closed = true;
      closePromise ??= (async () => {
        await opening;
        try {
          await handle?.close();
        } finally {
          fileCloseSettled = true;
          this.readClosers.delete(close);
          releaseIfDrained();
        }
      })();
      return closePromise;
    };
    this.readClosers.add(close);
    try {
      const reference = await this.readReference(referenceId, signal);
      if (reference.agentId !== agentId)
        throw new AttachmentStoreError("Attachment reference does not belong to this agent.");
      if (closed) throw new AttachmentStoreError("Original transfer closed before opening.");
      handle = await this.safeOpen(path.join(this.directory, "blobs", reference.sha256), signal);
      if (closed) throw new AttachmentStoreError("Original transfer closed while opening.");
      if ((await handle.stat()).size !== reference.byteLength)
        throw new AttachmentStoreError("Original attachment is unavailable or corrupt.");
      signal?.throwIfAborted();
      const file = handle;
      const chunkBytes = this.limits.chunkBytes;
      opened();
      return {
        reference,
        close,
        dispatchSend,
        settled,
        async *chunks(chunkSignal) {
          const hash = createHash("sha256");
          let offset = 0;
          while (offset < reference.byteLength) {
            chunkSignal.throwIfAborted();
            if (closed) throw new AttachmentStoreError("Original transfer is closed.");
            const buffer = Buffer.alloc(Math.min(chunkBytes, reference.byteLength - offset));
            const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
            chunkSignal.throwIfAborted();
            if (!bytesRead) throw new AttachmentStoreError("Original attachment is incomplete.");
            hash.update(buffer.subarray(0, bytesRead));
            offset += bytesRead;
            yield buffer.subarray(0, bytesRead);
          }
          if (hash.digest("hex") !== reference.sha256)
            throw new AttachmentStoreError("Original attachment hash is corrupt.");
        },
      };
    } catch (error) {
      opened();
      return withAttachmentResource(() => Promise.reject(error), close);
    }
  }
  close(): Promise<void> {
    this.closing = true;
    this.closePromise ??= this.drainAndClose();
    return this.closePromise;
  }
  private async drainAndClose(): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const drain = this.activeWrite?.done ?? Promise.resolve();
      await Promise.race([
        drain,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () =>
              reject(
                new AttachmentStoreError(
                  "Attachment mutations did not drain; writer ownership has been retained.",
                ),
              ),
            this.limits.closeMs,
          );
        }),
      ]);
    } catch (error) {
      return withAttachmentResource(
        () => Promise.reject(error),
        async () => {
          await this.owner?.handle.close();
        },
      );
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    const reads = [...this.readClosers].map((close) => close());
    const readResults = Promise.allSettled(reads);
    const owner = this.owner;
    this.owner = null;
    await withAttachmentResource(
      async () => {
        if (owner) await this.releaseOwner(owner);
      },
      async () => {
        const failures = (await readResults)
          .filter((result) => result.status === "rejected")
          .map((result) => result.reason);
        if (failures.length)
          throw new AggregateError(failures, "Attachment read handles could not all close.", {
            cause: failures[0],
          });
      },
    );
  }
  private async releaseOwner(owner: OwnerIdentity): Promise<void> {
    let ownerClosed = false;
    const closeOwner = async () => {
      if (ownerClosed) return;
      ownerClosed = true;
      await owner.handle.close();
    };
    await withAttachmentResource(async () => {
      const file = path.join(this.directory, "writer");
      const current = await this.safeOpen(file);
      await withAttachmentResource(
        async () => {
          const stats = await current.stat();
          if (
            stats.dev !== owner.dev ||
            stats.ino !== owner.ino ||
            stats.size !== Buffer.byteLength(owner.token)
          )
            throw new AttachmentStoreError(
              "Attachment writer identity changed; ownership entry retained.",
            );
          if ((await current.readFile("utf8")) !== owner.token)
            throw new AttachmentStoreError(
              "Attachment writer identity is unverifiable; ownership entry retained.",
            );
        },
        () => current.close(),
      );
      await closeOwner();
      // Cooperative owners never replace this entry. This is not compare-and-delete against external filesystem actors.
      await this.io.unlink(file);
      await this.syncDirectory(this.directory);
    }, closeOwner);
  }
}
