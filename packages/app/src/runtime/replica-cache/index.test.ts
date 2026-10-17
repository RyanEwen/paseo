import { REPLICA_SINGLETON_ROW_ID } from "./row-store-schema";
import { describe, expect, it } from "vitest";
import type { WorkspaceDescriptorPayload } from "@getpaseo/protocol/messages";
import {
  normalizeProjectDescriptor,
  normalizeWorkspaceDescriptor,
  type Agent,
} from "@/stores/session-store";
import type { StreamItem } from "@/types/stream";
import { normalizeAgentSnapshot } from "@/utils/agent-snapshots";
import { ReplicaCache } from ".";
import type { DirectoryCheckpoint } from "@/runtime/replica-cache";
import type {
  ReplicaHostRows,
  ReplicaRow,
  ReplicaRowChanges,
  ReplicaRowExpectation,
  ReplicaRowStore,
} from "./row-store";

const SERVER_ID = "cached-host";

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

class MemoryStorage implements ReplicaRowStore {
  readonly rows = new Map<string, ReplicaRow>();
  readonly changes: ReplicaRowChanges[] = [];
  readonly reads: Array<{
    serverId: string;
    kinds: readonly ReplicaRow["kind"][];
    ids?: readonly string[];
  }> = [];
  beforeConditionalApply: (() => void | Promise<void>) | null = null;
  reverseReadResults = false;
  writes = 0;
  cleanups = 0;
  nextWriteFailure: Error | null = null;
  persistentWriteFailure: Error | null = null;
  readGate: Promise<void> | null = null;
  onRead: (() => void) | null = null;
  /** Throws once a read goes past this count, so a non-terminating read loop fails the test. */
  readLimit: number | null = null;

  private key(row: Pick<ReplicaRow, "serverId" | "kind" | "id">): string {
    return `${row.serverId}:${row.kind}:${row.id}`;
  }

  async open(): Promise<void> {}

  async read(
    serverId: string,
    kinds: readonly ReplicaRow["kind"][],
    ids?: readonly string[],
  ): Promise<ReplicaRow[]> {
    this.reads.push({ serverId, kinds, ...(ids ? { ids } : {}) });
    if (this.readLimit !== null && this.reads.length > this.readLimit) {
      throw new Error(
        `replica cache read ${this.reads.length} passed the limit of ${this.readLimit}`,
      );
    }
    this.onRead?.();
    await this.readGate;
    const acceptedKinds = new Set(kinds);
    const acceptedIds = ids ? new Set(ids) : null;
    const result = [...this.rows.values()].filter(
      (row) =>
        row.serverId === serverId &&
        acceptedKinds.has(row.kind) &&
        (!acceptedIds || acceptedIds.has(row.id)),
    );
    return this.reverseReadResults ? result.toReversed() : result;
  }

  async readAll(): Promise<ReplicaHostRows[]> {
    const hosts = new Map<string, ReplicaRow[]>();
    for (const row of this.rows.values()) {
      const rows = hosts.get(row.serverId) ?? [];
      rows.push(row);
      hosts.set(row.serverId, rows);
    }
    return [...hosts].map(([serverId, rows]) => ({ serverId, rows }));
  }

  async apply(changes: ReplicaRowChanges): Promise<void> {
    this.writes += 1;
    if (this.persistentWriteFailure) throw this.persistentWriteFailure;
    if (this.nextWriteFailure) {
      const error = this.nextWriteFailure;
      this.nextWriteFailure = null;
      throw error;
    }
    this.changes.push(changes);
    for (const key of changes.deletes) this.rows.delete(this.key(key));
    for (const row of changes.upserts) this.rows.set(this.key(row), row);
  }

  async applyIfUnchanged(
    changes: ReplicaRowChanges,
    expected: readonly ReplicaRowExpectation[],
  ): Promise<boolean> {
    const before = this.beforeConditionalApply;
    this.beforeConditionalApply = null;
    await before?.();
    for (const condition of expected) {
      const current = this.rows.get(this.key(condition));
      if (
        condition.payload === null
          ? current !== undefined
          : current === undefined || current.payload !== condition.payload
      )
        return false;
    }
    await this.apply(changes);
    return true;
  }

  async deleteHost(serverId: string): Promise<void> {
    for (const [key, row] of this.rows) if (row.serverId === serverId) this.rows.delete(key);
  }

  async renameHost(oldServerId: string, newServerId: string): Promise<void> {
    for (const [key, row] of this.rows) {
      if (row.serverId !== oldServerId) continue;
      this.rows.delete(key);
      const renamed = { ...row, serverId: newServerId };
      this.rows.set(this.key(renamed), renamed);
    }
  }

  async clear(): Promise<void> {
    this.rows.clear();
  }
}

const noLegacyCleanup = { clearLegacyCache: async () => undefined };

function createCache(storage: MemoryStorage, maxBytes?: number): ReplicaCache {
  const cache = new ReplicaCache(storage, {
    ...noLegacyCleanup,
    ...(maxBytes ? { maxBytes } : {}),
  });
  cache.setHosts([SERVER_ID]);
  return cache;
}

function requireTimelineRow(storage: MemoryStorage): ReplicaRow {
  const row = [...storage.rows.values()].find((candidate) => candidate.kind === "timeline");
  if (!row) throw new Error("timeline row was not written");
  return row;
}

function agent(id = "agent-1"): Agent {
  return {
    ...normalizeAgentSnapshot(
      {
        id,
        provider: "codex",
        cwd: "/repo/paseo",
        workspaceId: "workspace-1",
        model: null,
        createdAt: "2026-07-18T08:00:00.000Z",
        updatedAt: "2026-07-18T08:01:00.000Z",
        lastUserMessageAt: "2026-07-18T08:01:00.000Z",
        status: "idle",
        capabilities: {
          supportsStreaming: true,
          supportsSessionPersistence: true,
          supportsDynamicModes: true,
          supportsMcpServers: true,
          supportsReasoningStream: true,
          supportsToolInvocations: true,
        },
        currentModeId: null,
        availableModes: [],
        pendingPermissions: [],
        persistence: null,
        title: "Cached agent",
        labels: {},
      },
      SERVER_ID,
    ),
    projectPlacement: null,
  };
}

function workspacePayload(): WorkspaceDescriptorPayload {
  return {
    id: "workspace-1",
    projectId: "project-1",
    projectDisplayName: "Paseo",
    projectRootPath: "/repo/paseo",
    workspaceDirectory: "/repo/paseo",
    projectKind: "git",
    workspaceKind: "local_checkout",
    name: "main",
    status: "running",
    statusEnteredAt: "2026-07-18T08:00:00.000Z",
    activityAt: null,
    archivingAt: null,
    diffStat: null,
    scripts: [],
  };
}

function timelineItem(text = "Cached"): StreamItem {
  return {
    kind: "assistant_message",
    id: "message-1",
    text,
    timestamp: new Date("2026-07-18T08:02:00.000Z"),
    timelineCursor: { epoch: "epoch-1", seq: 12 },
  };
}

function directory(
  checkpoint: DirectoryCheckpoint = { agents: { generation: "g", afterSeq: 12 } },
) {
  const cachedAgent = agent();
  const workspace = normalizeWorkspaceDescriptor(workspacePayload());
  const project = normalizeProjectDescriptor({
    projectId: "project-1",
    projectDisplayName: "Paseo",
    projectRootPath: "/repo/paseo",
    projectKind: "git",
  });
  return {
    agents: new Map([[cachedAgent.id, cachedAgent]]),
    workspaces: new Map([[workspace.id, workspace]]),
    projects: new Map([[project.projectId, project]]),
    checkpoint,
  };
}

function timeline(text = "Cached") {
  return {
    agentId: "agent-1",
    items: [timelineItem(text)],
    range: { epoch: "epoch-1", startSeq: 1, endSeq: 12 },
    hasOlder: true,
  };
}

function commitDirectory(
  cache: ReplicaCache,
  serverId: string,
  value: ReturnType<typeof directory>,
): void {
  cache.commitDirectoryMutations(
    serverId,
    [
      ...Array.from(value.agents.values(), (cachedAgent) => ({
        kind: "agent" as const,
        type: "upsert" as const,
        id: cachedAgent.id,
        value: cachedAgent,
      })),
      ...Array.from(value.workspaces.values(), (workspace) => ({
        kind: "workspace" as const,
        type: "upsert" as const,
        id: workspace.id,
        value: workspace,
      })),
      ...Array.from(value.projects.values(), (project) => ({
        kind: "project" as const,
        type: "upsert" as const,
        id: project.projectId,
        value: project,
      })),
    ],
    value.checkpoint,
  );
}

function deleteDirectory(cache: ReplicaCache, serverId: string): void {
  cache.commitDirectoryMutations(serverId, [
    { kind: "agent", type: "delete", id: "agent-1" },
    { kind: "workspace", type: "delete", id: "workspace-1" },
    { kind: "project", type: "delete", id: "project-1" },
  ]);
}

async function cacheWithCorruptCurrentBackground() {
  const storage = new MemoryStorage();
  const writer = createCache(storage);
  const checkpoint = {
    agents: { generation: "g", afterSeq: 12 },
    projects: { generation: "g", afterSeq: 4 },
    workspaces: { generation: "g", afterSeq: 8 },
  };
  const baseline = directory(checkpoint);
  commitDirectory(writer, SERVER_ID, baseline);
  writer.commitTimeline(SERVER_ID, "agent-1", timeline());
  await writer.flush();
  const key = `${SERVER_ID}:workspace:workspace-1`;
  const row = storage.rows.get(key)!;
  const payload = JSON.parse(row.payload) as Record<string, unknown>;
  delete payload.background;
  storage.rows.set(key, { ...row, payload: JSON.stringify(payload) });

  return { storage, baseline, reader: createCache(storage) };
}

async function expectCurrentWorkspaceRefresh({
  storage,
  baseline,
  reader,
}: Awaited<ReturnType<typeof cacheWithCorruptCurrentBackground>>): Promise<void> {
  const restored = await reader.readDirectory(SERVER_ID);
  expect(restored.workspaces.size).toBe(0);
  expect(restored.checkpoint).toEqual({
    agents: baseline.checkpoint.agents,
    projects: baseline.checkpoint.projects,
  });
  expect(restored.agents).toEqual(baseline.agents);
  expect(restored.projects).toEqual(baseline.projects);
  expect(await reader.readTimeline(SERVER_ID, "agent-1")).toEqual(timeline());
  expect((await createCache(storage).readDirectory(SERVER_ID)).checkpoint).toEqual(
    restored.checkpoint,
  );

  baseline.workspaces.set(
    "workspace-1",
    normalizeWorkspaceDescriptor({ ...workspacePayload(), background: true }),
  );
  reader.replaceDirectoryBaseline(SERVER_ID, baseline);
  await reader.flush();
  const refreshed = await createCache(storage).readDirectory(SERVER_ID);
  expect(refreshed.workspaces.get("workspace-1")?.background).toBe(true);
  expect(refreshed.checkpoint).toEqual(baseline.checkpoint);
}

describe("ReplicaCache", () => {
  it("retains repair invalidation when another host merges into its namespace", async () => {
    const cached = await cacheWithCorruptCurrentBackground();
    const renamed = SERVER_ID;
    cached.reader.setHosts([SERVER_ID, "alias-host"]);
    const checkpoint = {
      ...cached.baseline.checkpoint,
      agents: { generation: "renamed-agent", afterSeq: 77 },
    };
    cached.storage.beforeConditionalApply = () => {
      cached.reader.commitDirectoryMutations(SERVER_ID, [], checkpoint);
      cached.reader.reconcileServerId("alias-host", renamed);
    };
    await cached.reader.readDirectory(SERVER_ID);
    await cached.reader.flush();
    const reopened = new ReplicaCache(cached.storage, noLegacyCleanup);
    reopened.setHosts([renamed]);
    const restored = await reopened.readDirectory(renamed);
    expect(restored.workspaces.size).toBe(0);
    expect(restored.checkpoint).toEqual({
      agents: checkpoint.agents,
      projects: checkpoint.projects,
    });
    expect(await cached.storage.read("alias-host", ["workspace", "checkpoint"])).toEqual([]);
    cached.baseline.workspaces.set(
      "workspace-1",
      normalizeWorkspaceDescriptor({ ...workspacePayload(), background: true }),
    );
    cached.reader.replaceDirectoryBaseline(renamed, cached.baseline);
    await cached.reader.flush();
    expect((await reopened.readDirectory(renamed)).workspaces.get("workspace-1")?.background).toBe(
      true,
    );
    expect((await reopened.readDirectory(renamed)).checkpoint).toEqual(cached.baseline.checkpoint);
  });

  it("carries repair cursor invalidation through a rename accepted during CAS", async () => {
    const cached = await cacheWithCorruptCurrentBackground();
    const renamed = "renamed-host";
    const checkpoint = {
      ...cached.baseline.checkpoint,
      agents: { generation: "renamed-agent", afterSeq: 77 },
    };
    cached.storage.beforeConditionalApply = () => {
      cached.reader.commitDirectoryMutations(SERVER_ID, [], checkpoint);
      cached.reader.reconcileServerId(SERVER_ID, renamed);
    };
    await cached.reader.readDirectory(SERVER_ID);
    await cached.reader.flush();
    const reopened = new ReplicaCache(cached.storage, noLegacyCleanup);
    reopened.setHosts([renamed]);
    const restored = await reopened.readDirectory(renamed);
    expect(restored.workspaces.size).toBe(0);
    expect(restored.checkpoint).toEqual({
      agents: checkpoint.agents,
      projects: checkpoint.projects,
    });
    expect(await cached.storage.read(SERVER_ID, ["workspace", "checkpoint"])).toEqual([]);
    cached.baseline.workspaces.set(
      "workspace-1",
      normalizeWorkspaceDescriptor({ ...workspacePayload(), background: true }),
    );
    cached.reader.replaceDirectoryBaseline(renamed, cached.baseline);
    await cached.reader.flush();
    expect((await reopened.readDirectory(renamed)).workspaces.get("workspace-1")?.background).toBe(
      true,
    );
    expect((await reopened.readDirectory(renamed)).checkpoint).toEqual(cached.baseline.checkpoint);
  });

  it("keeps repaired workspace cursors invalid across concurrent and later stale checkpoints", async () => {
    const cached = await cacheWithCorruptCurrentBackground();
    const newer = {
      ...cached.baseline.checkpoint,
      agents: { generation: "new-agent", afterSeq: 99 },
    };
    cached.storage.beforeConditionalApply = () =>
      cached.reader.commitDirectoryMutations(
        SERVER_ID,
        [{ kind: "agent", type: "upsert", id: "agent-1", value: agent() }],
        newer,
      );
    await cached.reader.readDirectory(SERVER_ID);
    await cached.reader.flush();
    let restored = await createCache(cached.storage).readDirectory(SERVER_ID);
    expect(restored.workspaces.size).toBe(0);
    expect(restored.checkpoint).toEqual({ agents: newer.agents, projects: newer.projects });
    cached.reader.commitDirectoryMutations(SERVER_ID, [], newer);
    await cached.reader.flush();
    restored = await createCache(cached.storage).readDirectory(SERVER_ID);
    expect(restored.checkpoint).toEqual({ agents: newer.agents, projects: newer.projects });
    expect(await cached.reader.readTimeline(SERVER_ID, "agent-1")).toEqual(timeline());
  });

  it("allows a complete baseline with the same cursor accepted during repair", async () => {
    const cached = await cacheWithCorruptCurrentBackground();
    cached.baseline.workspaces.set(
      "workspace-1",
      normalizeWorkspaceDescriptor({ ...workspacePayload(), background: true }),
    );
    cached.storage.beforeConditionalApply = () =>
      cached.reader.replaceDirectoryBaseline(SERVER_ID, cached.baseline);
    await cached.reader.readDirectory(SERVER_ID);
    await cached.reader.flush();
    const restored = await createCache(cached.storage).readDirectory(SERVER_ID);
    expect(restored.workspaces.get("workspace-1")?.background).toBe(true);
    expect(restored.checkpoint).toEqual(cached.baseline.checkpoint);
    cached.reader.commitDirectoryMutations(SERVER_ID, [], cached.baseline.checkpoint);
    await cached.reader.flush();
    expect((await createCache(cached.storage).readDirectory(SERVER_ID)).checkpoint).toEqual(
      cached.baseline.checkpoint,
    );
  });

  it.each(["mismatch", "error"] as const)("creates no cursor fence on CAS %s", async (outcome) => {
    const cached = await cacheWithCorruptCurrentBackground();
    const workspace = normalizeWorkspaceDescriptor({ ...workspacePayload(), background: true });
    cached.baseline.workspaces.set("workspace-1", workspace);
    if (outcome === "error") cached.storage.nextWriteFailure = new Error("repair failed");
    else
      cached.storage.beforeConditionalApply = async () => {
        const peer = createCache(cached.storage);
        peer.replaceDirectoryBaseline(SERVER_ID, cached.baseline);
        await peer.flush();
      };
    await cached.reader.readDirectory(SERVER_ID);
    cached.reader.commitDirectoryMutations(
      SERVER_ID,
      [{ kind: "workspace", type: "upsert", id: "workspace-1", value: workspace }],
      cached.baseline.checkpoint,
    );
    await cached.reader.flush();
    expect((await createCache(cached.storage).readDirectory(SERVER_ID)).checkpoint).toEqual(
      cached.baseline.checkpoint,
    );
  });

  it("rebuilds budget accounting after committed repair invalidates read publication", async () => {
    const other = "other-host";
    const storage = new MemoryStorage();
    const writer = new ReplicaCache(storage, noLegacyCleanup);
    writer.setHosts([SERVER_ID, other]);
    commitDirectory(writer, SERVER_ID, directory());
    commitDirectory(writer, other, directory());
    await writer.flush();
    storage.rows.set(`${SERVER_ID}:agent:agent-1`, {
      serverId: SERVER_ID,
      kind: "agent",
      id: "agent-1",
      payload: `{${"x".repeat(5000)}`,
    });
    const bytes = [...storage.rows.values()].reduce(
      (sum, row) => sum + Buffer.byteLength(row.payload),
      0,
    );
    const cache = new ReplicaCache(storage, { ...noLegacyCleanup, maxBytes: bytes + 100 });
    cache.setHosts([SERVER_ID, other]);
    commitDirectory(cache, other, directory());
    await cache.flush();
    storage.beforeConditionalApply = () =>
      cache.commitTimeline(SERVER_ID, "agent-1", timeline("x".repeat(1000)));
    expect(await cache.readAgent(SERVER_ID, "agent-1")).toBeUndefined();
    await cache.flush();
    expect(storage.rows.has(`${SERVER_ID}:agent:agent-1`)).toBe(false);
    expect(storage.rows.has(`${other}:agent:agent-1`)).toBe(true);
    expect((await createCache(storage).readTimeline(SERVER_ID, "agent-1"))?.items).toEqual(
      timeline("x".repeat(1000)).items,
    );
  });

  it.each([null, undefined, 42])(
    "returns a bounded miss for non-string checkpoint payload %s",
    async (payload) => {
      const cached = await cacheWithCorruptCurrentBackground();
      const key = `${SERVER_ID}:checkpoint:singleton`;
      const row = cached.storage.rows.get(key)!;
      cached.storage.rows.set(key, { ...row, payload: payload as unknown as string });
      const before = await cached.storage.readAll();
      cached.storage.readLimit = 4;
      expect((await cached.reader.readDirectory(SERVER_ID)).checkpoint).toBeUndefined();
      expect(await cached.reader.readWorkspace(SERVER_ID, "workspace-1")).toBeUndefined();
      expect(await cached.storage.readAll()).toEqual(before);
      expect(cached.storage.reads.length).toBeLessThanOrEqual(4);
    },
  );

  it.each(["directory", "workspace"] as const)(
    "repairs current-cache missing background with %s-first reads",
    async (first) => {
      const cached = await cacheWithCorruptCurrentBackground();
      if (first === "workspace")
        expect(await cached.reader.readWorkspace(SERVER_ID, "workspace-1")).toBeUndefined();
      await expectCurrentWorkspaceRefresh(cached);
    },
  );

  it.each([false, true])(
    "validates current checkpoint authority independently of row order (%s)",
    async (reverse) => {
      const cached = await cacheWithCorruptCurrentBackground();
      cached.storage.reverseReadResults = reverse;
      await expectCurrentWorkspaceRefresh(cached);
    },
  );

  it.each(["directory", "workspace"] as const)(
    "retains provisional legacy rows and timelines with %s-first reads",
    async (first) => {
      const cached = await cacheWithCorruptCurrentBackground();
      const key = `${SERVER_ID}:checkpoint:singleton`;
      const checkpoint = cached.storage.rows.get(key)!;
      cached.storage.rows.set(key, {
        ...checkpoint,
        payload: JSON.stringify({ version: 1, cursors: cached.baseline.checkpoint }),
      });
      if (first === "workspace")
        expect((await cached.reader.readWorkspace(SERVER_ID, "workspace-1"))?.workspace.id).toBe(
          "workspace-1",
        );
      const restored = await cached.reader.readDirectory(SERVER_ID);
      expect(restored.workspaces.has("workspace-1")).toBe(true);
      expect(restored.checkpoint).toBeUndefined();
      expect(await cached.reader.readTimeline(SERVER_ID, "agent-1")).toEqual(timeline());
      expect(await cached.storage.read(SERVER_ID, ["checkpoint"])).toEqual([]);
      expect(
        JSON.parse(cached.storage.rows.get(`${SERVER_ID}:workspace:workspace-1`)!.payload),
      ).not.toHaveProperty("background");
      const reopened = createCache(cached.storage);
      reopened.commitDirectoryMutations(SERVER_ID, [], {
        agents: cached.baseline.checkpoint.agents,
      });
      await reopened.flush();
      const provisional = await createCache(cached.storage).readDirectory(SERVER_ID);
      expect(provisional.workspaces.has("workspace-1")).toBe(true);
      expect(provisional.checkpoint).toEqual({ agents: cached.baseline.checkpoint.agents });
    },
  );

  it("preserves valid siblings when repairing one current workspace", async () => {
    const cached = await cacheWithCorruptCurrentBackground();
    const peer = createCache(cached.storage);
    peer.commitDirectoryMutations(SERVER_ID, [
      {
        kind: "workspace",
        type: "upsert",
        id: "sibling",
        value: normalizeWorkspaceDescriptor({
          ...workspacePayload(),
          id: "sibling",
          background: true,
        }),
      },
    ]);
    await peer.flush();
    const restored = await cached.reader.readDirectory(SERVER_ID);
    expect([...restored.workspaces.keys()]).toEqual(["sibling"]);
    expect(restored.workspaces.get("sibling")?.background).toBe(true);
    expect(restored.agents).toEqual(cached.baseline.agents);
    expect(restored.projects).toEqual(cached.baseline.projects);
    expect(restored.checkpoint).toEqual({
      agents: cached.baseline.checkpoint.agents,
      projects: cached.baseline.checkpoint.projects,
    });
  });

  it.each(["directory", "workspace"] as const)(
    "rereads a replacement baseline instead of applying stale %s repair",
    async (first) => {
      const cached = await cacheWithCorruptCurrentBackground();
      const baseline = directory({
        ...cached.baseline.checkpoint,
        workspaces: { generation: "new", afterSeq: 99 },
      });
      baseline.workspaces.set(
        "workspace-1",
        normalizeWorkspaceDescriptor({ ...workspacePayload(), background: true }),
      );
      cached.storage.beforeConditionalApply = async () => {
        const peer = createCache(cached.storage);
        peer.replaceDirectoryBaseline(SERVER_ID, baseline);
        await peer.flush();
      };
      if (first === "workspace")
        expect(
          (await cached.reader.readWorkspace(SERVER_ID, "workspace-1"))?.workspace.background,
        ).toBe(true);
      const restored = await cached.reader.readDirectory(SERVER_ID);
      expect(restored.workspaces.get("workspace-1")?.background).toBe(true);
      expect(restored.checkpoint).toEqual(baseline.checkpoint);
      expect((await createCache(cached.storage).readDirectory(SERVER_ID)).checkpoint).toEqual(
        baseline.checkpoint,
      );
    },
  );

  it("rereads locally accepted pending replacement instead of publishing a stale repair", async () => {
    const cached = await cacheWithCorruptCurrentBackground();
    const baseline = directory({
      ...cached.baseline.checkpoint,
      workspaces: { generation: "new", afterSeq: 99 },
    });
    baseline.workspaces.set(
      "workspace-1",
      normalizeWorkspaceDescriptor({ ...workspacePayload(), background: true }),
    );
    cached.storage.beforeConditionalApply = () =>
      cached.reader.replaceDirectoryBaseline(SERVER_ID, baseline);
    const restored = await cached.reader.readDirectory(SERVER_ID);
    expect(restored.workspaces.get("workspace-1")?.background).toBe(true);
    expect(restored.checkpoint).toEqual(baseline.checkpoint);
  });

  it("does not resurrect rows after host removal and re-addition during repair", async () => {
    const cached = await cacheWithCorruptCurrentBackground();
    cached.storage.beforeConditionalApply = () => {
      cached.reader.setHosts([]);
      cached.reader.setHosts([SERVER_ID]);
    };
    const restored = await cached.reader.readDirectory(SERVER_ID);
    expect(restored.workspaces.size).toBe(0);
    expect(restored.checkpoint).toBeUndefined();
    expect(await cached.storage.readAll()).toEqual([]);
  });

  it("fails closed on conditional storage failure without spinning or altering durable rows", async () => {
    const cached = await cacheWithCorruptCurrentBackground();
    const before = await cached.storage.readAll();
    cached.storage.nextWriteFailure = new Error("conditional repair failed");
    cached.storage.readLimit = 8;
    const restored = await cached.reader.readDirectory(SERVER_ID);
    expect(restored.workspaces.size).toBe(0);
    expect(restored.checkpoint).toBeUndefined();
    expect(await cached.storage.readAll()).toEqual(before);
    expect(cached.storage.reads.length).toBeLessThanOrEqual(8);
    cached.storage.readLimit = null;
    await expectCurrentWorkspaceRefresh(cached);
  });

  it("rejects pre-baseline-fix checkpoints without discarding cached rows or timelines", async () => {
    const storage = new MemoryStorage();
    const writer = createCache(storage);
    const baseline = directory();
    writer.replaceDirectoryBaseline(SERVER_ID, baseline);
    writer.commitTimeline(SERVER_ID, "agent-1", timeline());
    await writer.flush();
    await storage.apply({
      deletes: [],
      upserts: [
        {
          serverId: SERVER_ID,
          kind: "checkpoint",
          id: "singleton",
          payload: JSON.stringify(baseline.checkpoint),
        },
      ],
    });

    const reader = createCache(storage);
    const restored = await reader.readDirectory(SERVER_ID);
    expect(restored.checkpoint).toBeUndefined();
    expect([...restored.workspaces.keys()]).toEqual([...baseline.workspaces.keys()]);
    expect([...restored.projects.keys()]).toEqual([...baseline.projects.keys()]);
    expect([...restored.agents.keys()]).toEqual([...baseline.agents.keys()]);
    expect(await reader.readTimeline(SERVER_ID, "agent-1")).toEqual(timeline());
    expect(await storage.read(SERVER_ID, ["checkpoint"])).toEqual([]);

    reader.replaceDirectoryBaseline(SERVER_ID, baseline);
    await reader.flush();
    expect((await createCache(storage).readDirectory(SERVER_ID)).checkpoint).toEqual(
      baseline.checkpoint,
    );
  });

  it.each([true, false])(
    "preserves workspace background=%s across durable cache reads",
    async (background) => {
      const storage = new MemoryStorage();
      const writer = createCache(storage);
      const baseline = directory({ workspaces: { generation: "workspaces", afterSeq: 7 } });
      baseline.workspaces.get("workspace-1")!.background = background;
      writer.replaceDirectoryBaseline(SERVER_ID, baseline);
      await writer.flush();

      const reader = createCache(storage);
      expect(
        (await reader.readDirectory(SERVER_ID)).workspaces.get("workspace-1")?.background,
      ).toBe(background);
      expect((await reader.readWorkspace(SERVER_ID, "workspace-1"))?.workspace.background).toBe(
        background,
      );
      expect((await reader.readDirectory(SERVER_ID)).checkpoint).toEqual(baseline.checkpoint);
    },
  );

  it("refreshes checkpoints written before background visibility was cached while retaining rows", async () => {
    const storage = new MemoryStorage();
    const writer = createCache(storage);
    const baseline = directory({ workspaces: { generation: "workspaces", afterSeq: 7 } });
    writer.replaceDirectoryBaseline(SERVER_ID, baseline);
    writer.commitTimeline(SERVER_ID, "agent-1", timeline());
    await writer.flush();
    const row = (await storage.read(SERVER_ID, ["workspace"], ["workspace-1"]))[0]!;
    const payload = JSON.parse(row.payload);
    delete payload.background;
    await storage.apply({
      deletes: [],
      upserts: [
        { ...row, payload: JSON.stringify(payload) },
        {
          serverId: SERVER_ID,
          kind: "checkpoint",
          id: "singleton",
          payload: JSON.stringify({ version: 1, cursors: baseline.checkpoint }),
        },
      ],
    });

    const reader = createCache(storage);
    const restored = await reader.readDirectory(SERVER_ID);
    expect(restored.checkpoint).toBeUndefined();
    expect([...restored.workspaces.keys()]).toEqual([...baseline.workspaces.keys()]);
    expect([...restored.projects.keys()]).toEqual([...baseline.projects.keys()]);
    expect([...restored.agents.keys()]).toEqual([...baseline.agents.keys()]);
    expect(await reader.readTimeline(SERVER_ID, "agent-1")).toEqual(timeline());
    expect(await storage.read(SERVER_ID, ["checkpoint"])).toEqual([]);
  });

  it("does nothing until an owner explicitly commits data", async () => {
    const storage = new MemoryStorage();
    const cache = createCache(storage);

    await cache.flush();

    expect(storage.writes).toBe(0);
    expect(storage.rows.size).toBe(0);
  });

  it("round-trips explicit directory and timeline commits", async () => {
    const storage = new MemoryStorage();
    const writer = createCache(storage);
    commitDirectory(writer, SERVER_ID, directory());
    writer.commitTimeline(SERVER_ID, "agent-1", timeline());
    await writer.flush();

    const reader = createCache(storage);
    const restoredDirectory = await reader.readDirectory(SERVER_ID);
    const restoredTimeline = await reader.readTimeline(SERVER_ID, "agent-1");

    expect(restoredDirectory.agents.get("agent-1")?.title).toBe("Cached agent");
    expect(restoredDirectory.workspaces.get("workspace-1")?.name).toBe("main");
    expect(restoredDirectory.projects.get("project-1")?.projectDisplayName).toBe("Paseo");
    expect(restoredDirectory.checkpoint).toEqual({ agents: { generation: "g", afterSeq: 12 } });
    expect(restoredTimeline).toEqual(timeline());
  });

  it("preserves pending timeline updates across directory baseline replacement", async () => {
    const storage = new MemoryStorage();
    const writer = createCache(storage);
    writer.commitTimeline(SERVER_ID, "agent-1", timeline("Latest visible reply"));
    writer.replaceDirectoryBaseline(SERVER_ID, directory());
    await writer.flush();

    const reader = createCache(storage);
    expect(await reader.readTimeline(SERVER_ID, "agent-1")).toEqual(
      timeline("Latest visible reply"),
    );
  });

  it("preserves clearing a timeline across directory baseline replacement", async () => {
    const storage = new MemoryStorage();
    const writer = createCache(storage);
    writer.commitTimeline(SERVER_ID, "agent-1", timeline());
    await writer.flush();
    writer.commitTimeline(SERVER_ID, "agent-1", { ...timeline(), items: [], range: null });
    writer.replaceDirectoryBaseline(SERVER_ID, directory());
    await writer.flush();

    const reader = createCache(storage);
    expect(await reader.readTimeline(SERVER_ID, "agent-1")).toEqual({
      ...timeline(),
      items: [],
      range: null,
      hasOlder: false,
    });
  });

  it("serializes and writes only keyed directory mutations", async () => {
    const storage = new MemoryStorage();
    const cache = createCache(storage);
    const changed = agent("changed-agent");
    let titleReads = 0;
    Object.defineProperty(changed, "title", {
      configurable: true,
      enumerable: true,
      get: () => {
        titleReads += 1;
        return "Changed agent";
      },
    });

    cache.commitDirectoryMutations(
      SERVER_ID,
      [{ kind: "agent", type: "upsert", id: changed.id, value: changed }],
      { agents: { generation: "g", afterSeq: 13 } },
    );

    expect(titleReads).toBe(0);
    await cache.flush();
    expect(titleReads).toBe(1);
    expect(storage.changes).toHaveLength(1);
    expect(storage.changes[0]?.upserts.map(({ kind, id }) => ({ kind, id }))).toEqual([
      { kind: "agent", id: "changed-agent" },
      { kind: "checkpoint", id: "singleton" },
    ]);
    expect(storage.changes[0]?.deletes).toEqual([]);
  });

  it("round-trips identified and anonymous open turns without changing protocol status", async () => {
    const storage = new MemoryStorage();
    const writer = createCache(storage);
    const identified = agent("identified");
    identified.turn = {
      phase: "open",
      turnId: "turn-1",
      startedAt: new Date("2026-08-31T12:00:00.000Z"),
      cancellationRequestId: null,
    };
    const anonymous = agent("anonymous");
    anonymous.turn = {
      phase: "open",
      turnId: null,
      startedAt: null,
      cancellationRequestId: null,
    };
    writer.commitDirectoryMutations(SERVER_ID, [
      { kind: "agent", type: "upsert", id: identified.id, value: identified },
      { kind: "agent", type: "upsert", id: anonymous.id, value: anonymous },
    ]);
    await writer.flush();

    const restored = await createCache(storage).readDirectory(SERVER_ID);

    expect(restored.agents.get("identified")).toMatchObject({
      status: "idle",
      turn: {
        phase: "open",
        turnId: "turn-1",
        startedAt: new Date("2026-08-31T12:00:00.000Z"),
        cancellationRequestId: null,
      },
    });
    expect(restored.agents.get("anonymous")).toMatchObject({
      status: "idle",
      turn: {
        phase: "open",
        turnId: null,
        startedAt: null,
        cancellationRequestId: null,
      },
    });
  });

  it("coalesces timeline values before serialization", async () => {
    const storage = new MemoryStorage();
    const cache = createCache(storage);
    let textReads = 0;
    const changedTimeline = timeline();
    Object.defineProperty(changedTimeline.items[0], "text", {
      configurable: true,
      enumerable: true,
      get: () => {
        textReads += 1;
        return "Latest";
      },
    });

    cache.commitTimeline(SERVER_ID, "agent-1", timeline("Old"));
    cache.commitTimeline(SERVER_ID, "agent-1", changedTimeline);

    expect(textReads).toBe(0);
    await cache.flush();
    expect(textReads).toBe(1);
    expect(storage.changes[0]?.upserts.map(({ kind, id }) => ({ kind, id }))).toEqual([
      { kind: "timeline", id: "agent-1" },
    ]);
  });

  it("never reads directory rows older than an accepted deferred deletion", async () => {
    const storage = new MemoryStorage();
    const cache = createCache(storage);
    commitDirectory(cache, SERVER_ID, directory());
    await cache.flush();

    deleteDirectory(cache, SERVER_ID);

    expect(await cache.readAgent(SERVER_ID, "agent-1")).toBeUndefined();
    expect(await cache.readWorkspace(SERVER_ID, "workspace-1")).toBeUndefined();
    expect((await cache.readDirectory(SERVER_ID)).projects.size).toBe(0);
  });

  it("fails closed when an accepted deletion cannot be persisted before a read", async () => {
    const storage = new MemoryStorage();
    const cache = createCache(storage);
    commitDirectory(cache, SERVER_ID, directory());
    await cache.flush();
    storage.nextWriteFailure = new Error("disk busy");

    deleteDirectory(cache, SERVER_ID);

    expect(await cache.readWorkspace(SERVER_ID, "workspace-1")).toBeUndefined();
  });

  it("gives up a read instead of retrying while the store keeps rejecting writes", async () => {
    const storage = new MemoryStorage();
    const cache = createCache(storage);
    commitDirectory(cache, SERVER_ID, directory());
    await cache.flush();
    storage.persistentWriteFailure = new Error("QuotaExceededError");
    storage.reads.length = 0;
    storage.readLimit = 5;

    deleteDirectory(cache, SERVER_ID);

    expect(await cache.readWorkspace(SERVER_ID, "workspace-1")).toBeUndefined();
    expect(storage.reads.length).toBeLessThanOrEqual(1);
  });

  it("still reads a host whose rows are stored when another host's write is rejected", async () => {
    const storage = new MemoryStorage();
    const cache = new ReplicaCache(storage, noLegacyCleanup);
    cache.setHosts([SERVER_ID, "other-host"]);
    commitDirectory(cache, SERVER_ID, directory());
    await cache.flush();
    storage.persistentWriteFailure = new Error("QuotaExceededError");

    commitDirectory(cache, "other-host", directory());

    expect((await cache.readWorkspace(SERVER_ID, "workspace-1"))?.workspace.id).toBe("workspace-1");
  });

  it("discards a durable read when the host changes while it is in flight", async () => {
    const storage = new MemoryStorage();
    const cache = createCache(storage);
    commitDirectory(cache, SERVER_ID, directory());
    await cache.flush();
    const started = deferred();
    const release = deferred();
    storage.onRead = started.resolve;
    storage.readGate = release.promise;

    const reading = cache.readAgent(SERVER_ID, "agent-1");
    await started.promise;
    deleteDirectory(cache, SERVER_ID);
    release.resolve();

    expect(await reading).toBeUndefined();
  });

  it("never reads a timeline older than an accepted deferred replacement", async () => {
    const storage = new MemoryStorage();
    const cache = createCache(storage);
    cache.commitTimeline(SERVER_ID, "agent-1", timeline("Old"));
    await cache.flush();

    cache.commitTimeline(SERVER_ID, "agent-1", timeline("New"));

    expect((await cache.readTimeline(SERVER_ID, "agent-1"))?.items).toEqual([timelineItem("New")]);
  });

  it("round-trips plugin timeline items", async () => {
    const storage = new MemoryStorage();
    const writer = createCache(storage);
    const pluginItem: StreamItem = {
      kind: "plugin",
      id: "reports/test-report/1",
      pluginId: "reports",
      pluginItemId: "test-report/1",
      itemKind: "test-report",
      version: 1,
      data: { passed: 4, failed: 0 },
      timestamp: new Date("2026-07-18T08:02:00.000Z"),
      timelineCursor: { epoch: "epoch-1", seq: 12 },
    };
    writer.commitTimeline(SERVER_ID, "agent-1", {
      agentId: "agent-1",
      items: [pluginItem],
      range: { epoch: "epoch-1", startSeq: 12, endSeq: 12 },
      hasOlder: true,
    });
    await writer.flush();

    const reader = createCache(storage);
    expect((await reader.readTimeline(SERVER_ID, "agent-1"))?.items).toEqual([pluginItem]);
  });

  it("drops cached plugin timeline items without a plugin-local id", async () => {
    const storage = new MemoryStorage();
    const writer = createCache(storage);
    const pluginItem = {
      kind: "plugin",
      id: "reports/test-report/1",
      pluginId: "reports",
      pluginItemId: "test-report/1",
      itemKind: "test-report",
      version: 1,
      data: { passed: 4 },
      timestamp: new Date("2026-07-18T08:02:00.000Z"),
    } satisfies StreamItem;
    writer.commitTimeline(SERVER_ID, "agent-1", {
      agentId: "agent-1",
      items: [pluginItem],
      range: { epoch: "epoch-1", startSeq: 12, endSeq: 12 },
      hasOlder: true,
    });
    await writer.flush();
    const row = requireTimelineRow(storage);
    const payload = JSON.parse(row.payload) as { items: Array<Record<string, unknown>> };
    delete payload.items[0]?.pluginItemId;
    storage.rows.set(`${row.serverId}:${row.kind}:${row.id}`, {
      ...row,
      payload: JSON.stringify(payload),
    });

    expect(await createCache(storage).readTimeline(SERVER_ID, "agent-1")).toBeUndefined();
  });

  it("refetches old cached Markdown fragments instead of offering them as whole messages", async () => {
    const storage = new MemoryStorage();
    const writer = createCache(storage);
    writer.commitTimeline(SERVER_ID, "agent-1", timeline());
    await writer.flush();
    const row = requireTimelineRow(storage);
    const payload = JSON.parse(row.payload) as { items: Array<Record<string, unknown>> };
    Object.assign(payload.items[0]!, { blockGroupId: "message-1", blockIndex: 0 });
    storage.rows.set(`${row.serverId}:${row.kind}:${row.id}`, {
      ...row,
      payload: JSON.stringify(payload),
    });

    expect(await createCache(storage).readTimeline(SERVER_ID, "agent-1")).toBeUndefined();
  });

  it("reads one requested agent and the focused timeline without scanning directory rows", async () => {
    const storage = new MemoryStorage();
    const writer = createCache(storage);
    commitDirectory(writer, SERVER_ID, directory());
    writer.commitTimeline(SERVER_ID, "agent-1", timeline());
    await writer.flush();

    const reader = createCache(storage);
    expect((await reader.readAgent(SERVER_ID, "agent-1"))?.id).toBe("agent-1");
    expect((await reader.readTimeline(SERVER_ID, "agent-1"))?.items).toEqual([timelineItem()]);
    expect(storage.reads).toEqual([
      { serverId: SERVER_ID, kinds: ["agent"], ids: ["agent-1"] },
      { serverId: SERVER_ID, kinds: ["timeline"], ids: ["agent-1"] },
    ]);
  });

  it("reads one requested workspace and its project without scanning the directory", async () => {
    const storage = new MemoryStorage();
    const writer = createCache(storage);
    commitDirectory(writer, SERVER_ID, directory());
    await writer.flush();

    const reader = createCache(storage);
    const restored = await reader.readWorkspace(SERVER_ID, "workspace-1");

    expect(restored?.workspace.id).toBe("workspace-1");
    expect(restored?.project?.projectId).toBe("project-1");
    expect(storage.reads).toEqual([
      {
        serverId: SERVER_ID,
        kinds: ["workspace", "checkpoint"],
        ids: ["workspace-1", REPLICA_SINGLETON_ROW_ID],
      },
      { serverId: SERVER_ID, kinds: ["project"], ids: ["project-1"] },
    ]);
  });

  it("treats a corrupt row as a scoped miss", async () => {
    const storage = new MemoryStorage();
    storage.rows.set(`${SERVER_ID}:agent:agent-1`, {
      serverId: SERVER_ID,
      kind: "agent",
      id: "agent-1",
      payload: "{bad",
    });
    storage.rows.set(`${SERVER_ID}:project:project-1`, {
      serverId: SERVER_ID,
      kind: "project",
      id: "project-1",
      payload: JSON.stringify({
        projectId: "project-1",
        projectDisplayName: "Paseo",
        projectCustomName: null,
        projectCustomIconRevision: null,
        projectRootPath: "/repo/paseo",
        projectKind: "git",
      }),
    });
    const cache = createCache(storage);

    const restored = await cache.readDirectory(SERVER_ID);

    expect(restored.agents.size).toBe(0);
    expect(restored.projects.get("project-1")?.projectDisplayName).toBe("Paseo");
    expect(storage.rows.has(`${SERVER_ID}:agent:agent-1`)).toBe(false);
    expect(storage.rows.has(`${SERVER_ID}:project:project-1`)).toBe(true);
  });

  it("removes a targeted corrupt row from eviction bookkeeping", async () => {
    const otherServerId = "other-host";
    const storage = new MemoryStorage();
    const writer = new ReplicaCache(storage, noLegacyCleanup);
    writer.setHosts([SERVER_ID, otherServerId]);
    commitDirectory(writer, SERVER_ID, directory());
    writer.commitTimeline(SERVER_ID, "agent-1", timeline());
    commitDirectory(writer, otherServerId, directory());
    await writer.flush();
    storage.rows.set(`${SERVER_ID}:agent:agent-1`, {
      serverId: SERVER_ID,
      kind: "agent",
      id: "agent-1",
      payload: `{${"x".repeat(5_000)}`,
    });
    const initialBytes = [...storage.rows.values()].reduce(
      (total, row) => total + Buffer.byteLength(row.payload),
      0,
    );
    const cache = new ReplicaCache(storage, { ...noLegacyCleanup, maxBytes: initialBytes + 100 });
    cache.setHosts([SERVER_ID, otherServerId]);
    commitDirectory(cache, otherServerId, directory());
    await cache.flush();

    expect(await cache.readAgent(SERVER_ID, "agent-1")).toBeUndefined();
    cache.commitTimeline(otherServerId, "agent-1", timeline("x".repeat(1_000)));
    await cache.flush();

    expect(storage.rows.has(`${SERVER_ID}:timeline:agent-1`)).toBe(true);
  });

  it("atomically removes a targeted corrupt row and its matching persisted cursor", async () => {
    const storage = new MemoryStorage();
    const writer = createCache(storage);
    commitDirectory(
      writer,
      SERVER_ID,
      directory({
        agents: { generation: "g", afterSeq: 12 },
        projects: { generation: "g", afterSeq: 4 },
      }),
    );
    await writer.flush();
    storage.rows.set(`${SERVER_ID}:agent:agent-1`, {
      serverId: SERVER_ID,
      kind: "agent",
      id: "agent-1",
      payload: "{bad",
    });

    expect(await createCache(storage).readAgent(SERVER_ID, "agent-1")).toBeUndefined();

    expect(storage.changes.at(-1)).toMatchObject({
      deletes: [{ serverId: SERVER_ID, kind: "agent", id: "agent-1" }],
      upserts: [{ serverId: SERVER_ID, kind: "checkpoint", id: "singleton" }],
    });
    expect((await createCache(storage).readDirectory(SERVER_ID)).checkpoint).toEqual({
      projects: { generation: "g", afterSeq: 4 },
    });
  });

  it("drops only the cursor whose cached entity baseline is corrupt", async () => {
    const storage = new MemoryStorage();
    const writer = createCache(storage);
    commitDirectory(
      writer,
      SERVER_ID,
      directory({
        agents: { generation: "g", afterSeq: 12 },
        projects: { generation: "g", afterSeq: 4 },
      }),
    );
    await writer.flush();
    storage.rows.set(`${SERVER_ID}:agent:agent-1`, {
      serverId: SERVER_ID,
      kind: "agent",
      id: "agent-1",
      payload: "{bad",
    });

    const restored = await createCache(storage).readDirectory(SERVER_ID);

    expect(restored.checkpoint).toEqual({
      projects: { generation: "g", afterSeq: 4 },
    });
    expect(storage.changes.at(-1)).toMatchObject({
      deletes: [{ serverId: SERVER_ID, kind: "agent", id: "agent-1" }],
      upserts: [{ serverId: SERVER_ID, kind: "checkpoint", id: "singleton" }],
    });
    const reopened = await createCache(storage).readDirectory(SERVER_ID);
    expect(reopened.checkpoint).toEqual({
      projects: { generation: "g", afterSeq: 4 },
    });
  });

  it("commits directory rows and their checkpoint in one storage transaction", async () => {
    const storage = new MemoryStorage();
    const cache = createCache(storage);

    commitDirectory(cache, SERVER_ID, directory());
    await cache.flush();

    expect(storage.changes).toHaveLength(1);
    expect(storage.changes[0]?.upserts.map((row) => row.kind).sort()).toEqual([
      "agent",
      "checkpoint",
      "project",
      "workspace",
    ]);
  });

  it("retries an explicit commit after a storage failure", async () => {
    const storage = new MemoryStorage();
    const cache = createCache(storage);
    storage.nextWriteFailure = new Error("disk busy");
    cache.commitTimeline(SERVER_ID, "agent-1", timeline("Retry me"));

    await cache.flush();
    expect(storage.rows.size).toBe(0);
    await cache.flush();

    expect((await cache.readTimeline(SERVER_ID, "agent-1"))?.items).toEqual([
      timelineItem("Retry me"),
    ]);
  });

  it("retries a timeline read invalidated by a concurrent directory commit", async () => {
    const storage = new MemoryStorage();
    const cache = createCache(storage);
    cache.commitTimeline(SERVER_ID, "agent-1", timeline("Persisted timeline"));
    await cache.flush();
    storage.onRead = () => {
      storage.onRead = null;
      commitDirectory(cache, SERVER_ID, directory());
    };

    expect((await cache.readTimeline(SERVER_ID, "agent-1"))?.items).toEqual([
      timelineItem("Persisted timeline"),
    ]);
  });

  it("rebuilds every directory row before restoring its checkpoint after eviction", async () => {
    const storage = new MemoryStorage();
    const cache = new ReplicaCache(storage, { ...noLegacyCleanup, maxBytes: 2_500 });
    cache.setHosts([SERVER_ID, "other-host"]);
    const cachedDirectory = directory();
    commitDirectory(cache, SERVER_ID, cachedDirectory);
    await cache.flush();
    commitDirectory(cache, "other-host", cachedDirectory);
    await cache.flush();
    expect([...storage.rows.values()].some((row) => row.serverId === SERVER_ID)).toBe(false);

    cache.commitDirectoryMutations(
      SERVER_ID,
      [{ kind: "agent", type: "upsert", id: "agent-1", value: agent() }],
      { agents: { generation: "new-generation", afterSeq: 99 } },
    );
    await cache.flush();

    expect([...storage.rows.values()].some((row) => row.serverId === SERVER_ID)).toBe(false);
    expect((await cache.readDirectory(SERVER_ID)).checkpoint).toBeUndefined();

    cache.replaceDirectoryBaseline(SERVER_ID, cachedDirectory);
    await cache.flush();

    expect(
      [...storage.rows.values()]
        .filter((row) => row.serverId === SERVER_ID)
        .map((row) => row.kind)
        .sort(),
    ).toEqual(["agent", "checkpoint", "project", "workspace"]);
  });

  it("runs legacy cleanup once when storage is first used", async () => {
    const storage = new MemoryStorage();
    const cache = new ReplicaCache(storage, {
      clearLegacyCache: async () => {
        storage.cleanups += 1;
      },
    });
    cache.setHosts([SERVER_ID]);

    await cache.readAgent(SERVER_ID, "missing");
    commitDirectory(cache, SERVER_ID, directory());
    await cache.flush();

    expect(storage.cleanups).toBe(1);
  });
});

it("retains semantic agent messages across disk-cache reconstruction", async () => {
  const storage = new MemoryStorage();
  const writer = createCache(storage);
  const value = timeline();
  value.items = [
    {
      kind: "tool_call",
      id: "delivery",
      timestamp: new Date(1),
      timelineCursor: { epoch: "epoch-1", seq: 12 },
      payload: {
        source: "agent",
        data: {
          provider: "codex",
          callId: "delivery",
          name: "agent_message",
          status: "completed",
          error: null,
          detail: { type: "plain_text", text: "Done" },
          agentMessage: {
            event: "finished",
            sender: { id: "remote::worker", title: "Reviewer" },
            text: "Done",
          },
        },
      },
    },
  ];
  writer.commitTimeline(SERVER_ID, "agent-1", value);
  await writer.flush();
  expect(await createCache(storage).readTimeline(SERVER_ID, "agent-1")).toEqual(value);
});
