import { z } from "zod";
import {
  AppSettingsPatchSchema,
  AppSettingsSnapshotSchema,
  type AppSettingsPatch,
  type AppSettingsSnapshot,
} from "@getpaseo/protocol/app-settings";
import {
  applySettingsPatches,
  cloneSettingsJson,
  isSyncedSettingsPath,
  settingsDiff,
  settingsFieldKey,
  settingsValueAtPath,
  settingsPathRevision,
} from "@getpaseo/protocol/app-settings-values";

const HostStateSchema = z.object({
  snapshot: AppSettingsSnapshotSchema,
  pending: z.array(AppSettingsPatchSchema),
  backup: z.record(z.string(), z.unknown()),
});
const LocalStateSchema = z.object({
  selectedHost: z.string().nullable(),
  hosts: z.record(z.string(), HostStateSchema),
});
type LocalState = z.infer<typeof LocalStateSchema>;
const EMPTY: AppSettingsSnapshot = {
  initialized: false,
  revision: 0,
  values: {},
  fieldRevisions: {},
};

export type SyncStatus =
  | "loading"
  | "local"
  | "reading"
  | "ready"
  | "offline"
  | "empty"
  | "unsupported"
  | "error"
  | "conflict"
  | "readonly";
export interface SyncState {
  selectedHost: string | null;
  status: SyncStatus;
  pendingCount: number;
  error: string | null;
  conflicts: string[][];
  canWrite: boolean;
}
export interface SettingsSyncTransport {
  supported: boolean;
  writable: boolean;
  read(): Promise<AppSettingsSnapshot>;
  patch(
    patches: AppSettingsPatch[],
    initialize: boolean,
  ): Promise<{ snapshot: AppSettingsSnapshot; conflicts: string[][] }>;
}
export interface SettingsSyncDeps {
  readLocal(): Promise<unknown>;
  writeLocal(value: LocalState): Promise<void>;
  getDeviceValues(purpose: "backup" | "publish"): Promise<Record<string, unknown>>;
  applyValues(values: Record<string, unknown>): Promise<void>;
}

/** Client policy and durable host-keyed outbox. Selection changes fence every async completion. */
export class SettingsSyncModel {
  private local: LocalState = { selectedHost: null, hosts: {} };
  private state: SyncState = {
    selectedHost: null,
    status: "loading",
    pendingCount: 0,
    error: null,
    conflicts: [],
    canWrite: false,
  };
  private generation = 0;
  private adoptedHost: string | null = null;
  private transport: SettingsSyncTransport | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private sending: Promise<void> | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly deps: SettingsSyncDeps) {}
  getState = (): SyncState => this.state;
  getGeneration(): number {
    return this.generation;
  }
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Read failures stay visible and cannot silently reset the settings authority to local. */
  async load(): Promise<void> {
    try {
      const value = await this.deps.readLocal();
      this.local =
        value === null ? { selectedHost: null, hosts: {} } : LocalStateSchema.parse(value);
      this.publish({
        selectedHost: this.local.selectedHost,
        status: this.local.selectedHost ? "reading" : "local",
        canWrite: this.local.selectedHost === null,
      });
    } catch (error) {
      this.fail(error);
    }
  }

  /** Persist selection only. Never seed, flush or adopt a destination until its read succeeds. */
  async selectHost(host: string | null): Promise<void> {
    const generation = ++this.generation;
    const previousTransport = this.transport;
    const previousAdoptedHost = this.adoptedHost;
    this.transport = null;
    this.adoptedHost = null;
    this.publish({ status: "reading", error: null, conflicts: [] });
    try {
      await this.serialize(async () => {
        if (generation !== this.generation) return;
        const next = { ...this.local, selectedHost: host };
        await this.deps.writeLocal(next);
        this.local = next;
        this.publish({
          selectedHost: host,
          status: host ? "reading" : "local",
          pendingCount: next.hosts[host ?? ""]?.pending.length ?? 0,
          canWrite: host === null,
        });
      });
    } catch (error) {
      if (generation === this.generation) {
        this.transport = previousTransport;
        this.adoptedHost = previousAdoptedHost;
        this.fail(error);
      }
      throw error;
    }
  }

  /** Bind only the chosen host's authenticated client. Reconnect always reads before flushing. */
  async connect(host: string, transport: SettingsSyncTransport | null): Promise<void> {
    if (host !== this.state.selectedHost) return;
    const generation = ++this.generation;
    this.transport = transport;
    if (!transport) {
      this.publish({ status: this.adoptedHost === host ? "offline" : "reading" });
      return;
    }
    if (!transport.supported) {
      this.adoptedHost = null;
      this.publish({ status: "unsupported" });
      return;
    }
    this.publish({ status: "reading", error: null, canWrite: transport.writable });
    try {
      const snapshot = await transport.read();
      if (!this.current(host, generation)) return;
      await this.receive(host, snapshot, generation);
      if (this.current(host, generation)) await this.flush();
    } catch (error) {
      if (this.current(host, generation)) this.fail(error);
    }
  }

  /** Remote adoption is an explicit command, never an observed local edit. */
  async receive(
    host: string,
    snapshot: AppSettingsSnapshot,
    generation = this.generation,
  ): Promise<void> {
    try {
      await this.serialize(async () => {
        if (!this.current(host, generation)) return;
        const old = this.local.hosts[host];
        if (old && snapshot.revision < old.snapshot.revision) return;
        const backup = old?.backup ?? (await this.deps.getDeviceValues("backup"));
        if (!this.current(host, generation)) return;
        // An unknown-outcome write that is already durable needs no second write.
        const pending = (old?.pending ?? []).filter(
          (patch) =>
            isSyncedSettingsPath(patch.path) &&
            JSON.stringify(settingsValueAtPath(snapshot.values, patch.path)) !==
              JSON.stringify(patch.value),
        );
        const next = {
          ...this.local,
          hosts: { ...this.local.hosts, [host]: { snapshot, pending, backup } },
        };
        await this.deps.writeLocal(next);
        this.local = next;
        if (!this.current(host, generation)) return;
        if (snapshot.initialized) {
          await this.deps.applyValues(applySettingsPatches(snapshot.values, pending));
          if (!this.current(host, generation)) return;
          this.adoptedHost = host;
        }
        let status: SyncStatus = "empty";
        if (snapshot.initialized) status = this.state.canWrite ? "ready" : "readonly";
        if (pending.length && this.state.conflicts.length) status = "conflict";
        this.publish({ status, pendingCount: pending.length, error: null });
      });
    } catch (error) {
      if (this.current(host, generation)) this.fail(error);
      throw error;
    }
  }

  /** Persist touched leaves under the original host before exposing their local projection. */
  async edit(patches: AppSettingsPatch[]): Promise<void> {
    const host = this.state.selectedHost;
    if (!host) throw new Error("No settings host selected");
    const generation = this.generation;
    if (
      !this.state.canWrite ||
      this.adoptedHost !== host ||
      !["ready", "offline"].includes(this.state.status)
    )
      throw new Error("Load the selected host's settings before editing");
    try {
      await this.serialize(async () => {
        if (!this.current(host, generation)) throw new Error("Settings host changed before saving");
        const record = this.local.hosts[host]!;
        const merged = new Map(
          record.pending.map((patch) => [settingsFieldKey(patch.path), patch]),
        );
        for (const patch of patches) {
          const key = settingsFieldKey(patch.path);
          const previous = merged.get(key);
          merged.set(key, {
            ...patch,
            expectedRevision: previous?.expectedRevision ?? patch.expectedRevision,
          });
        }
        const pending = [...merged.values()];
        const next = {
          ...this.local,
          hosts: { ...this.local.hosts, [host]: { ...record, pending } },
        };
        await this.deps.writeLocal(next);
        this.local = next;
        if (!this.current(host, generation)) return;
        await this.deps.applyValues(applySettingsPatches(record.snapshot.values, pending));
        if (this.current(host, generation)) this.publish({ pendingCount: pending.length });
      });
    } catch (error) {
      if (this.current(host, generation)) this.fail(error);
      throw error;
    }
    // The durable outbox permits offline work; remote failures remain visible in status.
    void this.flush();
  }

  getSnapshot(): AppSettingsSnapshot {
    return this.local.hosts[this.state.selectedHost ?? ""]?.snapshot ?? EMPTY;
  }

  /** An empty host is initialized only through this explicit user command, using revision zero. */
  async publishDeviceSettings(): Promise<void> {
    const host = this.state.selectedHost;
    const transport = this.transport;
    const generation = this.generation;
    if (!host || !transport?.writable || this.state.status !== "empty")
      throw new Error("Read an empty settings host before publishing");
    const values = await this.deps.getDeviceValues("publish");
    if (!this.current(host, generation)) return;
    const patches = settingsDiff({}, values, EMPTY).filter((patch) =>
      isSyncedSettingsPath(patch.path),
    );
    const result = await transport.patch(patches, true);
    if (!this.current(host, generation)) return;
    if (result.conflicts.length) {
      await this.serialize(async () => {
        if (!this.current(host, generation)) return;
        const record = this.local.hosts[host]!;
        const next = {
          ...this.local,
          hosts: { ...this.local.hosts, [host]: { ...record, pending: patches } },
        };
        await this.deps.writeLocal(next);
        this.local = next;
      });
    }
    await this.receive(host, result.snapshot, generation);
    if (result.conflicts.length) this.publish({ status: "conflict", conflicts: result.conflicts });
  }

  /** Retry a read without discarding this host's pending changes. */
  async retry(): Promise<void> {
    const host = this.state.selectedHost;
    if (host && this.transport) await this.connect(host, this.transport);
    else if (!host) await this.load();
  }

  /** Read before resolving, so a failed refresh retains every pending edit. */
  async useHostSettings(): Promise<void> {
    await this.resolveConflicts(false);
  }

  /** Explicitly keep touched local edits, rebasing only those paths onto the current host. */
  async keepDeviceChanges(): Promise<void> {
    await this.resolveConflicts(true);
  }

  private async resolveConflicts(keepDevice: boolean): Promise<void> {
    const host = this.state.selectedHost;
    const transport = this.transport;
    const generation = this.generation;
    if (!host || !transport) throw new Error("Connect to the settings host first");
    if (keepDevice && !transport.writable)
      throw new Error("This connection cannot change host settings");
    const snapshot = await transport.read();
    if (!this.current(host, generation)) return;
    await this.serialize(async () => {
      if (!this.current(host, generation)) return;
      const record = this.local.hosts[host];
      if (!record) return;
      const pending = keepDevice
        ? record.pending.map((patch) => ({
            ...patch,
            expectedRevision: settingsPathRevision(snapshot, patch.path),
          }))
        : [];
      const next = {
        ...this.local,
        hosts: { ...this.local.hosts, [host]: { ...record, pending } },
      };
      await this.deps.writeLocal(next);
      this.local = next;
    });
    if (this.current(host, generation)) this.publish({ conflicts: [] });
    await this.receive(host, snapshot, generation);
    if (this.current(host, generation)) await this.flush();
  }

  /** Restore the saved pre-adoption values in device-only mode without touching any host. */
  async restoreDeviceSettings(): Promise<void> {
    const host = this.state.selectedHost;
    const backup = this.local.hosts[host ?? ""]?.backup;
    if (!backup) throw new Error("No device backup is available");
    await this.selectHost(null);
    await this.serialize(async () => {
      if (this.state.selectedHost !== null) return;
      await this.deps.applyValues(backup);
    });
  }

  /** One in-flight outbox per model. A completion may acknowledge A, but never project A onto B. */
  async flush(): Promise<void> {
    if (this.sending) {
      await this.sending;
      await this.flush();
      return;
    }
    const host = this.state.selectedHost;
    const transport = this.transport;
    const generation = this.generation;
    if (!host || !transport || this.state.status !== "ready") return;
    const record = this.local.hosts[host];
    if (!record?.pending.length) {
      if (record && this.state.pendingCount !== 0)
        await this.receive(host, record.snapshot, generation);
      return;
    }
    const sent = cloneSettingsJson(record.pending).filter((patch) =>
      isSyncedSettingsPath(patch.path),
    );
    if (!sent.length) return;
    this.sending = (async () => {
      try {
        const result = await transport.patch(sent, false);
        await this.serialize(async () => {
          const current = this.local.hosts[host]!;
          const acknowledged = new Set(sent.map((patch) => JSON.stringify(patch)));
          const sentKeys = new Set(sent.map((patch) => settingsFieldKey(patch.path)));
          const pending = cloneSettingsJson(current.pending);
          if (!result.conflicts.length) {
            for (let index = pending.length - 1; index >= 0; index -= 1) {
              const patch = pending[index]!;
              if (acknowledged.has(JSON.stringify(patch))) pending.splice(index, 1);
              else if (sentKeys.has(settingsFieldKey(patch.path)))
                patch.expectedRevision = settingsPathRevision(result.snapshot, patch.path);
            }
          }
          const next = {
            ...this.local,
            hosts: {
              ...this.local.hosts,
              [host]: {
                ...current,
                snapshot:
                  result.snapshot.revision >= current.snapshot.revision
                    ? result.snapshot
                    : current.snapshot,
                pending,
              },
            },
          };
          await this.deps.writeLocal(next);
          this.local = next;
          if (!this.current(host, generation)) return;
          await this.deps.applyValues(
            applySettingsPatches(next.hosts[host]!.snapshot.values, pending),
          );
          if (!this.current(host, generation)) return;
          this.publish({
            status: result.conflicts.length ? "conflict" : "ready",
            conflicts: result.conflicts,
            pendingCount: pending.length,
          });
        });
      } catch (error) {
        if (this.current(host, generation)) this.fail(error);
      }
    })();
    await this.sending;
    this.sending = null;
    if (
      this.state.status === "ready" &&
      this.local.hosts[this.state.selectedHost ?? ""]?.pending.length
    )
      await this.flush();
  }

  private current(host: string, generation: number): boolean {
    return this.state.selectedHost === host && this.generation === generation;
  }
  private publish(patch: Partial<SyncState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  private fail(error: unknown): void {
    this.publish({
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => undefined);
    return result;
  }
}
