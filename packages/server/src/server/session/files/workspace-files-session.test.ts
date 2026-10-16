import {
  AttachmentStore,
  ATTACHMENT_LIMITS,
  attachmentFileSystem,
  type AttachmentFileSystem,
  type AttachmentLimits,
  type AttachmentReadLease,
} from "../../attachments/store.js";
import { AttachmentSession } from "../../attachments/session.js";
import { SessionDelivery } from "../owned-subscriptions/index.js";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import pino from "pino";
import {
  decodeFileTransferFrame,
  encodeFileTransferFrame,
  FileTransferOpcode,
  type FileTransferFrame,
} from "@getpaseo/protocol/binary-frames/index";
import {
  WorkspaceFilesSession,
  type WorkspaceFilesSessionHost,
} from "./workspace-files-session.js";
import { DownloadTokenStore } from "../../file-download/token-store.js";
import type { SessionOutboundMessage } from "../../messages.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

function makeSubsystem(
  options: {
    hasBinaryChannel?: boolean;
    emitBinary?: (frame: Uint8Array) => Promise<void> | void;
  } = {},
) {
  const emitted: SessionOutboundMessage[] = [];
  const binary: Uint8Array[] = [];
  let hasBinary = options.hasBinaryChannel ?? false;
  const host: WorkspaceFilesSessionHost = {
    emit: (msg) => emitted.push(msg),
    emitBinary: async (frame) => {
      binary.push(frame);
      await options.emitBinary?.(frame);
    },
    hasBinaryChannel: () => hasBinary,
  };
  const paseoHome = makeDir("workspace-files-home-");
  const subsystem = new WorkspaceFilesSession({
    host,
    downloadTokenStore: new DownloadTokenStore({ ttlMs: 60_000 }),
    paseoHome,
    logger: pino({ level: "silent" }),
  });
  return {
    subsystem,
    emitted,
    binary,
    paseoHome,
    setHasBinary: (value: boolean) => {
      hasBinary = value;
    },
  };
}

function uploadFrame(args: Parameters<typeof encodeFileTransferFrame>[0]): FileTransferFrame {
  const frame = decodeFileTransferFrame(encodeFileTransferFrame(args));
  if (!frame) {
    throw new Error("Expected a file transfer frame");
  }
  return frame;
}

describe("WorkspaceFilesSession", () => {
  test("creates an entry and emits the complete success response", async () => {
    const cwd = makeDir("workspace-files-create-");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileEntryCreateRequest({
      type: "fs.entry.create.request",
      cwd,
      parentPath: ".",
      name: "notes.txt",
      kind: "file",
      requestId: "req-create",
    });

    expect(existsSync(join(cwd, "notes.txt"))).toBe(true);
    expect(emitted).toEqual([
      {
        type: "fs.entry.create.response",
        payload: {
          cwd,
          parentPath: ".",
          path: "notes.txt",
          success: true,
          error: null,
          requestId: "req-create",
        },
      },
    ]);
  });

  test("passes entry creation errors through in the response", async () => {
    const cwd = makeDir("workspace-files-create-error-");
    writeFileSync(join(cwd, "notes.txt"), "existing");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileEntryCreateRequest({
      type: "fs.entry.create.request",
      cwd,
      parentPath: ".",
      name: "notes.txt",
      kind: "file",
      requestId: "req-create-error",
    });

    expect(emitted).toEqual([
      {
        type: "fs.entry.create.response",
        payload: {
          cwd,
          parentPath: ".",
          path: null,
          success: false,
          error: '"notes.txt" already exists',
          requestId: "req-create-error",
        },
      },
    ]);
  });

  test("renames an entry and emits the resulting path", async () => {
    const cwd = makeDir("workspace-files-rename-");
    writeFileSync(join(cwd, "notes.txt"), "rename me");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileEntryRenameRequest({
      type: "fs.entry.rename.request",
      cwd,
      path: "notes.txt",
      name: "renamed.txt",
      requestId: "req-rename",
    });

    expect(existsSync(join(cwd, "notes.txt"))).toBe(false);
    expect(existsSync(join(cwd, "renamed.txt"))).toBe(true);
    expect(emitted).toEqual([
      {
        type: "fs.entry.rename.response",
        payload: {
          cwd,
          path: "notes.txt",
          renamedPath: "renamed.txt",
          success: true,
          error: null,
          requestId: "req-rename",
        },
      },
    ]);
  });

  test("passes entry rename errors through in the response", async () => {
    const cwd = makeDir("workspace-files-rename-error-");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileEntryRenameRequest({
      type: "fs.entry.rename.request",
      cwd,
      path: "missing.txt",
      name: "renamed.txt",
      requestId: "req-rename-error",
    });

    expect(emitted).toEqual([
      {
        type: "fs.entry.rename.response",
        payload: {
          cwd,
          path: "missing.txt",
          renamedPath: null,
          success: false,
          error: "File or folder no longer exists",
          requestId: "req-rename-error",
        },
      },
    ]);
  });

  test("duplicates an entry and emits the resulting path", async () => {
    const cwd = makeDir("workspace-files-duplicate-");
    writeFileSync(join(cwd, "notes.txt"), "duplicate me");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileEntryDuplicateRequest({
      type: "fs.entry.duplicate.request",
      cwd,
      path: "notes.txt",
      requestId: "req-duplicate",
    });

    expect(readFileSync(join(cwd, "notes copy.txt"), "utf8")).toBe("duplicate me");
    expect(emitted).toEqual([
      {
        type: "fs.entry.duplicate.response",
        payload: {
          cwd,
          path: "notes.txt",
          duplicatedPath: "notes copy.txt",
          success: true,
          error: null,
          requestId: "req-duplicate",
        },
      },
    ]);
  });

  test("passes entry duplication errors through in the response", async () => {
    const cwd = makeDir("workspace-files-duplicate-error-");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileEntryDuplicateRequest({
      type: "fs.entry.duplicate.request",
      cwd,
      path: "missing.txt",
      requestId: "req-duplicate-error",
    });

    expect(emitted).toEqual([
      {
        type: "fs.entry.duplicate.response",
        payload: {
          cwd,
          path: "missing.txt",
          duplicatedPath: null,
          success: false,
          error: "File or folder no longer exists",
          requestId: "req-duplicate-error",
        },
      },
    ]);
  });

  test("deletes an entry and emits the complete success response", async () => {
    const cwd = makeDir("workspace-files-delete-");
    writeFileSync(join(cwd, "notes.txt"), "delete me");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileEntryDeleteRequest({
      type: "fs.entry.delete.request",
      cwd,
      path: "notes.txt",
      requestId: "req-delete",
    });

    expect(existsSync(join(cwd, "notes.txt"))).toBe(false);
    expect(emitted).toEqual([
      {
        type: "fs.entry.delete.response",
        payload: {
          cwd,
          path: "notes.txt",
          success: true,
          error: null,
          requestId: "req-delete",
        },
      },
    ]);
  });

  test("passes entry deletion errors through in the response", async () => {
    const cwd = makeDir("workspace-files-delete-error-");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileEntryDeleteRequest({
      type: "fs.entry.delete.request",
      cwd,
      path: "missing.txt",
      requestId: "req-delete-error",
    });

    expect(emitted).toEqual([
      {
        type: "fs.entry.delete.response",
        payload: {
          cwd,
          path: "missing.txt",
          success: false,
          error: "File or folder no longer exists",
          requestId: "req-delete-error",
        },
      },
    ]);
  });

  test("lists directory entries", async () => {
    const cwd = makeDir("workspace-files-list-");
    writeFileSync(join(cwd, "a.txt"), "alpha");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileExplorerRequest({
      type: "file_explorer_request",
      cwd,
      path: ".",
      mode: "list",
      requestId: "req-list",
    });

    expect(emitted).toHaveLength(1);
    const message = emitted[0];
    if (message.type !== "file_explorer_response") {
      throw new Error(`expected file_explorer_response, got ${message.type}`);
    }
    expect(message.payload.error).toBeNull();
    expect(message.payload.directory).not.toBeNull();
  });

  test("reads file content inline when the client has no binary channel", async () => {
    const cwd = makeDir("workspace-files-read-");
    writeFileSync(join(cwd, "notes.txt"), "hello world");
    const { subsystem, emitted, binary } = makeSubsystem({ hasBinaryChannel: false });

    await subsystem.handleFileExplorerRequest({
      type: "file_explorer_request",
      cwd,
      path: "notes.txt",
      mode: "file",
      requestId: "req-read",
      acceptBinary: true,
    });

    expect(binary).toEqual([]);
    expect(emitted).toHaveLength(1);
    const message = emitted[0];
    if (message.type !== "file_explorer_response") {
      throw new Error(`expected file_explorer_response, got ${message.type}`);
    }
    expect(message.payload.error).toBeNull();
    expect(message.payload.file).not.toBeNull();
  });

  test("streams binary frames when the client accepts binary and has a channel", async () => {
    const cwd = makeDir("workspace-files-binary-");
    writeFileSync(join(cwd, "notes.txt"), "hello world");
    const { subsystem, emitted, binary } = makeSubsystem({ hasBinaryChannel: true });

    await subsystem.handleFileExplorerRequest({
      type: "file_explorer_request",
      cwd,
      path: "notes.txt",
      mode: "file",
      requestId: "req-binary",
      acceptBinary: true,
    });

    expect(emitted).toEqual([]);
    expect(binary).toHaveLength(3);
    const opcodes = binary.map((frame) => decodeFileTransferFrame(frame)?.opcode);
    expect(opcodes).toEqual([
      FileTransferOpcode.FileBegin,
      FileTransferOpcode.FileChunk,
      FileTransferOpcode.FileEnd,
    ]);
  });

  test("rejects an over-budget file before opening a binary transfer", async () => {
    const cwd = makeDir("workspace-files-read-budget-");
    writeFileSync(join(cwd, "notes.txt"), "hello world");
    const { subsystem, emitted, binary } = makeSubsystem({ hasBinaryChannel: true });

    await subsystem.handleFileExplorerRequest({
      type: "file_explorer_request",
      cwd,
      path: "notes.txt",
      mode: "file",
      requestId: "req-read-budget",
      acceptBinary: true,
      maxBytes: 5,
    });

    expect(binary).toEqual([]);
    expect(emitted).toEqual([
      expect.objectContaining({
        type: "file_explorer_response",
        payload: expect.objectContaining({ error: "File is too large to display" }),
      }),
    ]);
  });

  test("streams a real file larger than the socket limit as paced ordered chunks", async () => {
    const cwd = makeDir("workspace-files-large-binary-");
    const fileBytes = Buffer.alloc(8 * 1024 * 1024 + 123);
    for (let index = 0; index < fileBytes.length; index += 1) {
      fileBytes[index] = index % 251;
    }
    writeFileSync(join(cwd, "large.bin"), fileBytes);

    let releaseFirstChunk: (() => void) | undefined;
    const firstChunkSent = new Promise<void>((resolve) => {
      releaseFirstChunk = resolve;
    });
    let chunkSends = 0;
    const { subsystem, emitted, binary } = makeSubsystem({
      hasBinaryChannel: true,
      emitBinary: async (frame) => {
        if (decodeFileTransferFrame(frame)?.opcode !== FileTransferOpcode.FileChunk) return;
        chunkSends += 1;
        if (chunkSends === 1) await firstChunkSent;
      },
    });

    const transfer = subsystem.handleFileExplorerRequest({
      type: "file_explorer_request",
      cwd,
      path: "large.bin",
      mode: "file",
      requestId: "req-large-binary",
      acceptBinary: true,
    });

    await expect.poll(() => chunkSends).toBe(1);
    expect(binary.map((frame) => decodeFileTransferFrame(frame)?.opcode)).toEqual([
      FileTransferOpcode.FileBegin,
      FileTransferOpcode.FileChunk,
    ]);

    await subsystem.handleFileExplorerRequest({
      type: "file_explorer_request",
      cwd,
      path: ".",
      mode: "list",
      requestId: "req-unrelated-list",
    });
    expect(emitted).toEqual([
      expect.objectContaining({
        type: "file_explorer_response",
        payload: expect.objectContaining({ requestId: "req-unrelated-list", error: null }),
      }),
    ]);

    releaseFirstChunk?.();
    await transfer;

    const frames = binary.map((frame) => decodeFileTransferFrame(frame));
    const chunks = frames.flatMap((frame) =>
      frame?.opcode === FileTransferOpcode.FileChunk ? [frame.payload] : [],
    );
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.byteLength <= 256 * 1024)).toBe(true);
    expect(
      Buffer.compare(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))), fileBytes),
    ).toBe(0);
    expect(frames.at(0)?.opcode).toBe(FileTransferOpcode.FileBegin);
    expect(frames.at(-1)?.opcode).toBe(FileTransferOpcode.FileEnd);
    expect(emitted).toHaveLength(1);
  }, 30_000);

  test("rejects an empty file-explorer cwd with an error envelope", async () => {
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileExplorerRequest({
      type: "file_explorer_request",
      cwd: "  ",
      path: ".",
      mode: "list",
      requestId: "req-empty",
    });

    expect(emitted).toEqual([
      {
        type: "file_explorer_response",
        payload: expect.objectContaining({
          error: "cwd is required",
          directory: null,
          file: null,
          requestId: "req-empty",
        }),
      },
    ]);
  });

  test("issues a download token for a real file", async () => {
    const cwd = makeDir("workspace-files-token-");
    writeFileSync(join(cwd, "report.txt"), "hello world");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileDownloadTokenRequest({
      type: "file_download_token_request",
      cwd,
      path: "report.txt",
      requestId: "req-token",
    });

    expect(emitted).toHaveLength(1);
    const message = emitted[0];
    if (message.type !== "file_download_token_response") {
      throw new Error(`expected file_download_token_response, got ${message.type}`);
    }
    expect(message.payload.error).toBeNull();
    expect(typeof message.payload.token).toBe("string");
    expect(message.payload.fileName).toBe("report.txt");
    expect(message.payload.size).toBe(11);
  });

  test("rejects an empty download-token cwd with an error envelope", async () => {
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileDownloadTokenRequest({
      type: "file_download_token_request",
      cwd: "",
      path: "report.txt",
      requestId: "req-token-empty",
    });

    expect(emitted).toEqual([
      {
        type: "file_download_token_response",
        payload: expect.objectContaining({
          token: null,
          error: "cwd is required",
          requestId: "req-token-empty",
        }),
      },
    ]);
  });

  test("responds to a project icon request", async () => {
    const cwd = makeDir("workspace-files-icon-");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleProjectIconRequest({
      type: "project_icon_request",
      cwd,
      requestId: "req-icon",
    });

    expect(emitted).toHaveLength(1);
    const message = emitted[0];
    if (message.type !== "project_icon_response") {
      throw new Error(`expected project_icon_response, got ${message.type}`);
    }
    expect(message.payload.cwd).toBe(cwd);
    expect(message.payload.error).toBeNull();
  });

  test("round-trips an upload through transfer frames", async () => {
    const { subsystem, emitted, paseoHome } = makeSubsystem();

    const source = {};
    const ownership = new SessionDelivery((_source, message) => {
      emitted.push(message);
    });
    ownership.attach(source, true);
    const request = {
      type: "file.upload.request",
      fileName: "notes.txt",
      mimeType: "text/plain",
      size: 11,
      modifiedAt: "2026-05-02T00:00:00.000Z",
      requestId: "req-upload",
    } as const;
    await ownership.request(source, request, async () =>
      subsystem.handleFileUploadRequest(request, ownership),
    );
    await subsystem.handleFileTransferFrame(
      uploadFrame({
        opcode: FileTransferOpcode.FileBegin,
        requestId: "req-upload",
        metadata: {
          mime: "text/plain",
          size: 11,
          encoding: "binary",
          modifiedAt: "2026-05-02T00:00:00.000Z",
          fileName: "notes.txt",
        },
      }),
      source,
    );
    await subsystem.handleFileTransferFrame(
      uploadFrame({
        opcode: FileTransferOpcode.FileChunk,
        requestId: "req-upload",
        payload: new TextEncoder().encode("hello world"),
      }),
      source,
    );
    await subsystem.handleFileTransferFrame(
      uploadFrame({ opcode: FileTransferOpcode.FileEnd, requestId: "req-upload" }),
      source,
    );

    const message = emitted.find((entry) => entry.type === "file.upload.response");
    if (message?.type !== "file.upload.response") {
      throw new Error("expected a file.upload.response message");
    }
    expect(message.payload.error).toBeNull();
    expect(message.payload.file?.fileName).toBe("notes.txt");
    const file = message.payload.file;
    if (!file) throw new Error("Expected uploaded file");
    expect(file.path.startsWith(join(paseoHome, "uploads"))).toBe(true);
    expect(readFileSync(file.path, "utf8")).toBe("hello world");
    await ownership.close();
  });
});

async function attachmentSubsystem(
  options: {
    supported?: boolean;
    allowed?: boolean;
    blockFirst?: boolean;
    idleMs?: number;
    limits?: Partial<AttachmentLimits>;
    io?: AttachmentFileSystem;
    sendFailure?: Error;
    onFailure?: (error: unknown) => void;
  } = {},
) {
  const home = makeDir("attachment-session-");
  const store = await AttachmentStore.create(
    home,
    {
      ...ATTACHMENT_LIMITS,
      freeBytes: 0,
      readIdleMs: options.idleMs ?? 30_000,
      ...options.limits,
    },
    options.io,
  );
  const writer = await store.reserve({ agentId: "owner-a" });
  let reference;
  try {
    reference = await writer.commit({
      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X1r0AAAAASUVORK5CYII=",
      mimeType: "image/png",
    });
  } finally {
    await writer.release();
  }
  const emitted: SessionOutboundMessage[] = [];
  const frames: FileTransferFrame[] = [];
  const source = {};
  const cancellation = new AbortController();
  let unblock = () => {};
  const blocked = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  let began = () => {};
  const started = new Promise<void>((resolve) => {
    began = resolve;
  });
  const session = new AttachmentSession(store, {
    emit: (message) => emitted.push(message),
    supportsOriginals: (candidate) => candidate === source && options.supported !== false,
    mayRead: () => options.allowed !== false,
    requestSignal: () => cancellation.signal,
    reportFailure: options.onFailure,
    send: async (bytes, candidate) => {
      expect(candidate).toBe(source);
      const frame = decodeFileTransferFrame(bytes);
      if (!frame) throw new Error("invalid fixture frame");
      frames.push(frame);
      began();
      if (options.sendFailure) throw options.sendFailure;
      if (options.blockFirst && frames.length === 1) await blocked;
    },
  });
  return { store, reference, session, source, cancellation, emitted, frames, started, unblock };
}
describe("owned original attachment retrieval", () => {
  test("list, metadata and acknowledged bytes use the same owner reference", async () => {
    const fixture = await attachmentSubsystem();
    try {
      await fixture.session.handle(
        { type: "attachments.list.request", agentId: "owner-a", requestId: "list" },
        fixture.source,
      );
      await fixture.session.handle(
        {
          type: "attachments.get.request",
          agentId: "owner-a",
          referenceId: fixture.reference.id,
          requestId: "get",
        },
        fixture.source,
      );
      await fixture.session.handle(
        {
          type: "attachments.read.request",
          agentId: "owner-a",
          referenceId: fixture.reference.id,
          requestId: "read",
        },
        fixture.source,
      );
      expect(fixture.emitted[0]).toMatchObject({
        type: "attachments.list.response",
        payload: { references: [fixture.reference] },
      });
      expect(fixture.emitted[1]).toMatchObject({
        type: "attachments.get.response",
        payload: { reference: fixture.reference },
      });
      expect(fixture.emitted[2]).toMatchObject({
        type: "attachments.read.response",
        payload: { error: null, reference: fixture.reference },
      });
      const chunks = fixture.frames.filter(
        (frame) => frame.opcode === FileTransferOpcode.FileChunk,
      );
      expect(Buffer.concat(chunks.map((frame) => frame.payload)).length).toBe(
        fixture.reference.byteLength,
      );
      expect(fixture.frames.at(-1)?.opcode).toBe(FileTransferOpcode.FileEnd);
    } finally {
      await fixture.store.close();
    }
  });
  test("plugin-style sources retain metadata but cannot borrow another physical socket's read support", async () => {
    const fixture = await attachmentSubsystem();
    const unsupported = {};
    try {
      await fixture.session.handle(
        { type: "attachments.list.request", agentId: "owner-a", requestId: "list" },
        unsupported,
      );
      await fixture.session.handle(
        {
          type: "attachments.get.request",
          agentId: "owner-a",
          referenceId: fixture.reference.id,
          requestId: "get",
        },
        unsupported,
      );
      await fixture.session.handle(
        {
          type: "attachments.read.request",
          agentId: "owner-a",
          referenceId: fixture.reference.id,
          requestId: "bad-read",
        },
        unsupported,
      );
      expect(fixture.emitted[1]).toMatchObject({
        payload: { error: null, reference: fixture.reference },
      });
      expect(fixture.emitted[2]).toMatchObject({
        payload: { error: expect.stringContaining("acknowledged") },
      });
      expect(fixture.frames).toHaveLength(0);
    } finally {
      await fixture.store.close();
    }
  });
  test("one unacknowledged frame prevents the next chunk and cancel stays on its initiating source", async () => {
    const fixture = await attachmentSubsystem({ blockFirst: true });
    const read = fixture.session.handle(
      {
        type: "attachments.read.request",
        agentId: "owner-a",
        referenceId: fixture.reference.id,
        requestId: "read",
      },
      fixture.source,
    );
    try {
      await fixture.started;
      expect(fixture.frames).toHaveLength(1);
      await fixture.session.handle(
        {
          type: "attachments.read.cancel.request",
          readRequestId: "read",
          requestId: "other-cancel",
        },
        {},
      );
      expect(fixture.emitted.at(-1)).toMatchObject({ payload: { canceled: false } });
      await fixture.session.handle(
        { type: "attachments.read.cancel.request", readRequestId: "read", requestId: "cancel" },
        fixture.source,
      );
      await read;
      expect(fixture.frames).toHaveLength(1);
      expect(fixture.emitted.at(-1)).toMatchObject({
        type: "attachments.read.response",
        payload: { reference: null, error: expect.stringContaining("canceled") },
      });
    } finally {
      fixture.unblock();
      await read;
      await fixture.store.close();
    }
  });
  test.each(["disconnect", "timeout"])(
    "%s stops production and closes the file while retaining unacknowledged send capacity",
    async (reason) => {
      const fixture = await attachmentSubsystem({
        blockFirst: true,
        idleMs: reason === "timeout" ? 1 : 30_000,
        limits: { globalReads: 1 },
      });
      const read = fixture.session.handle(
        {
          type: "attachments.read.request",
          agentId: "owner-a",
          referenceId: fixture.reference.id,
          requestId: "read",
        },
        fixture.source,
      );
      try {
        await fixture.started;
        if (reason === "disconnect") fixture.cancellation.abort();
        await read;
        expect(fixture.frames).toHaveLength(1);
        expect(fixture.emitted.at(-1)).toMatchObject({
          type: "attachments.read.response",
          payload: { reference: null, error: expect.any(String) },
        });
        await expect(fixture.store.openRead("owner-a", fixture.reference.id, {})).rejects.toThrow(
          "busy",
        );
        fixture.unblock();
        await vi.waitFor(async () => {
          const lease = await fixture.store.openRead("owner-a", fixture.reference.id, {});
          await lease.close();
        });
      } finally {
        fixture.unblock();
        await read;
        await fixture.store.close();
      }
    },
  );
  test("permission and wrong-owner failures cannot send an original", async () => {
    const denied = await attachmentSubsystem({ allowed: false });
    try {
      await denied.session.handle(
        {
          type: "attachments.read.request",
          agentId: "owner-a",
          referenceId: denied.reference.id,
          requestId: "read",
        },
        denied.source,
      );
      expect(denied.frames).toHaveLength(0);
    } finally {
      await denied.store.close();
    }
    const fixture = await attachmentSubsystem();
    try {
      await fixture.session.handle(
        {
          type: "attachments.read.request",
          agentId: "wrong-owner",
          referenceId: fixture.reference.id,
          requestId: "read",
        },
        fixture.source,
      );
      expect(fixture.frames).toHaveLength(0);
      expect(fixture.emitted.at(-1)).toMatchObject({
        payload: { error: expect.stringContaining("belong") },
      });
    } finally {
      await fixture.store.close();
    }
  });
});

function attachmentGate() {
  let resolve = () => {};
  let reject = (_error: Error) => {};
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

test.each(
  ["cancel", "disconnect", "timeout"].flatMap((reason) =>
    ["begin", "chunk"].map((boundary) => ({ reason, boundary })),
  ),
)(
  "$reason retains four dispatched $boundary slots until actual acknowledgement, scoped by source and ID",
  async ({ reason, boundary }) => {
    const fixture = await attachmentSubsystem();
    const sources = [{}, {}, {}, {}];
    const acknowledgements = sources.map(() => attachmentGate());
    const started = attachmentGate();
    const frames: Array<{ source: object; opcode: number }> = [];
    let blocked = 0;
    const replies: Array<{ source: object; message: SessionOutboundMessage }> = [];
    const deliveries = [new SessionDelivery(() => {}), new SessionDelivery(() => {})];
    const sessions = deliveries.map((delivery, index) => {
      delivery.attach(sources[index * 2], true);
      delivery.attach(sources[index * 2 + 1], true);
      return new AttachmentSession(fixture.store, {
        emit: (message, source) => {
          replies.push({ source, message });
        },
        supportsOriginals: () => true,
        mayRead: () => true,
        requestSignal: () => delivery.requestSignal,
        send: async (bytes, source) => {
          const frame = decodeFileTransferFrame(bytes);
          if (!frame) throw new Error("invalid fixture frame");
          frames.push({ source, opcode: frame.opcode });
          if (
            frame.opcode ===
            (boundary === "begin" ? FileTransferOpcode.FileBegin : FileTransferOpcode.FileChunk)
          ) {
            if (++blocked === 4) started.resolve();
            await acknowledgements[sources.indexOf(source)].promise;
          }
        },
      });
    });
    const request = {
      type: "attachments.read.request",
      agentId: "owner-a",
      referenceId: fixture.reference.id,
      requestId: "same-id",
    } as const;
    const probeLeases: AttachmentReadLease[] = [];
    vi.useFakeTimers();
    const reads = sources.map((source, index) =>
      deliveries[Math.floor(index / 2)].request(source, request, () =>
        sessions[Math.floor(index / 2)].handle(request, source),
      ),
    );
    try {
      await started.promise;
      await sessions[0].handle(
        {
          type: "attachments.read.cancel.request",
          readRequestId: "same-id",
          requestId: "cancel-first",
        },
        sources[0],
      );
      await reads[0];
      await deliveries[0].detach(sources[0]);
      expect(
        replies.filter(
          ({ source, message }) =>
            source === sources[1] && message.type === "attachments.read.response",
        ),
      ).toHaveLength(0);
      await expect(fixture.store.openRead("owner-a", fixture.reference.id, {})).rejects.toThrow(
        "busy",
      );
      if (reason === "timeout") await vi.advanceTimersByTimeAsync(30_000);
      else
        for (let index = 1; index < sources.length; index++) {
          if (reason === "disconnect")
            await deliveries[Math.floor(index / 2)].detach(sources[index]);
          else
            await sessions[Math.floor(index / 2)].handle(
              {
                type: "attachments.read.cancel.request",
                readRequestId: "same-id",
                requestId: `cancel-${index}`,
              },
              sources[index],
            );
        }
      await Promise.all(reads);
      vi.useRealTimers();
      expect(frames).toHaveLength(boundary === "begin" ? 4 : 8);
      expect(frames.every((frame) => frame.opcode !== FileTransferOpcode.FileEnd)).toBe(true);
      await expect(fixture.store.openRead("owner-a", fixture.reference.id, {})).rejects.toThrow(
        "busy",
      );
      acknowledgements[0].resolve();
      const lease = await vi.waitFor(() =>
        fixture.store.openRead("owner-a", fixture.reference.id, {}),
      );
      probeLeases.push(lease);
      await expect(fixture.store.openRead("owner-a", fixture.reference.id, {})).rejects.toThrow(
        "busy",
      );
      acknowledgements[1].reject(new Error("fixture acknowledgement rejected"));
      const second = await vi.waitFor(() =>
        fixture.store.openRead("owner-a", fixture.reference.id, {}),
      );
      probeLeases.push(second);
      await expect(fixture.store.openRead("owner-a", fixture.reference.id, {})).rejects.toThrow(
        "busy",
      );
      expect(frames).toHaveLength(boundary === "begin" ? 4 : 8);
    } finally {
      vi.useRealTimers();
      for (const acknowledgement of acknowledgements) acknowledgement.resolve();
      await Promise.all(reads);
      for (const lease of probeLeases) await lease.close();
      await Promise.all(deliveries.map((delivery) => delivery.close()));
      await fixture.store.close();
    }
  },
);

test.each(["disconnect", "revoke", "timeout"])(
  "%s during metadata I/O retains admission until actual completion and reads no original chunks",
  async (reason) => {
    const entered = attachmentGate();
    const proceed = attachmentGate();
    let delay = false;
    let originalOpens = 0;
    let originalReads = 0;
    const options = {
      allowed: true,
      limits: { globalReads: 1 },
      io: {
        ...attachmentFileSystem,
        open: async (file, flags, permissions) => {
          const handle = await attachmentFileSystem.open(file, flags, permissions);
          const value = String(file);
          const blob = /[\\/]blobs[\\/]/.test(value);
          if (delay && blob) originalOpens++;
          return new Proxy(handle, {
            get(target, key) {
              if (key === "readFile" && delay && /[\\/]references[\\/]/.test(value))
                return async () => {
                  entered.resolve();
                  await proceed.promise;
                  return target.readFile("utf8");
                };
              if (key === "read" && blob)
                return async () => {
                  originalReads++;
                  throw new Error("Metadata must not read original chunks");
                };
              const member = Reflect.get(target, key);
              return typeof member === "function" ? member.bind(target) : member;
            },
          });
        },
      } satisfies AttachmentFileSystem,
    };
    const fixture = await attachmentSubsystem(options);
    delay = true;
    vi.useFakeTimers();
    const metadata = fixture.session.handle(
      {
        type: "attachments.get.request",
        agentId: "owner-a",
        referenceId: fixture.reference.id,
        requestId: "delayed-metadata",
      },
      fixture.source,
    );
    try {
      await entered.promise;
      if (reason === "disconnect") fixture.cancellation.abort();
      else if (reason === "revoke") {
        options.allowed = false;
        fixture.session.revokeReads();
      } else await vi.advanceTimersByTimeAsync(30_000);
      await expect(fixture.store.openRead("owner-a", fixture.reference.id, {})).rejects.toThrow(
        "busy",
      );
      proceed.resolve();
      await metadata;
      vi.useRealTimers();
      expect(fixture.emitted).toEqual([
        expect.objectContaining({
          type: "attachments.get.response",
          payload: expect.objectContaining({ reference: null, error: expect.any(String) }),
        }),
      ]);
      expect(originalOpens).toBe(0);
      expect(originalReads).toBe(0);
      delay = false;
      const lease = await fixture.store.openRead("owner-a", fixture.reference.id, {});
      await lease.close();
    } finally {
      vi.useRealTimers();
      proceed.resolve();
      await metadata;
      await fixture.store.close();
    }
  },
);

test.each(["complete", "send-failure"])(
  "%s with file-close failure emits one terminal result and preserves the first failure",
  async (mode) => {
    const closeFailure = new Error("fixture original handle close failed");
    const sendFailure = new Error("fixture original send failed");
    const failures: unknown[] = [];
    let closes = 0;
    const fixture = await attachmentSubsystem({
      limits: { globalReads: 1 },
      onFailure: (error) => {
        failures.push(error);
      },
      sendFailure: mode === "send-failure" ? sendFailure : undefined,
      io: {
        ...attachmentFileSystem,
        open: async (file, flags, permissions) => {
          const handle = await attachmentFileSystem.open(file, flags, permissions);
          if (!/[\\/]blobs[\\/]/.test(String(file))) return handle;
          return new Proxy(handle, {
            get(target, key) {
              if (key === "close")
                return async () => {
                  closes++;
                  await target.close();
                  throw closeFailure;
                };
              const member = Reflect.get(target, key);
              return typeof member === "function" ? member.bind(target) : member;
            },
          });
        },
      },
    });
    try {
      await fixture.session.handle(
        {
          type: "attachments.read.request",
          agentId: "owner-a",
          referenceId: fixture.reference.id,
          requestId: "close-failure",
        },
        fixture.source,
      );
      expect(closes).toBe(1);
      expect(fixture.emitted).toEqual([
        expect.objectContaining({
          type: "attachments.read.response",
          payload: expect.objectContaining({ reference: null, error: expect.any(String) }),
        }),
      ]);
      if (mode === "send-failure")
        expect(failures).toEqual([
          expect.objectContaining({ cause: sendFailure, errors: [sendFailure, closeFailure] }),
        ]);
      else {
        expect(fixture.frames.at(-1)?.opcode).toBe(FileTransferOpcode.FileEnd);
        expect(failures).toEqual([closeFailure]);
      }
      const probe = await fixture.store.openRead("owner-a", fixture.reference.id, {});
      await expect(probe.close()).rejects.toBe(closeFailure);
      expect(closes).toBe(2);
    } finally {
      await fixture.store.close();
    }
  },
);

test("a lease closed before the next send continuation never invokes the still-capable source", async () => {
  const fixture = await attachmentSubsystem({
    limits: { globalReads: 1 },
    sendFailure: new Error("Closed lease must never dispatch"),
  });
  const originalOpen = fixture.store.openRead.bind(fixture.store);
  let closedLease: AttachmentReadLease | undefined;
  const opening = vi.spyOn(fixture.store, "openRead").mockImplementationOnce(async (...args) => {
    const lease = await originalOpen(...args);
    closedLease = lease;
    await lease.close();
    return lease;
  });
  try {
    await fixture.session.handle(
      {
        type: "attachments.read.request",
        agentId: "owner-a",
        referenceId: fixture.reference.id,
        requestId: "closed-before-send",
      },
      fixture.source,
    );
    expect(fixture.cancellation.signal.aborted).toBe(false);
    expect(fixture.frames).toHaveLength(0);
    expect(fixture.emitted).toEqual([
      expect.objectContaining({
        type: "attachments.read.response",
        payload: expect.objectContaining({
          reference: null,
          error: expect.stringContaining("closed"),
        }),
      }),
    ]);
    const probe = await originalOpen("owner-a", fixture.reference.id, {});
    try {
      if (!closedLease) throw new Error("Expected captured closed lease");
      await closedLease.close();
      await closedLease.settled;
      await expect(originalOpen("owner-a", fixture.reference.id, {})).rejects.toThrow("busy");
    } finally {
      await probe.close();
    }
    const next = await originalOpen("owner-a", fixture.reference.id, {});
    await next.close();
  } finally {
    opening.mockRestore();
    await fixture.store.close();
  }
});
