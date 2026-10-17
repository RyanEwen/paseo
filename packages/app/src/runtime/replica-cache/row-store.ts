export { REPLICA_ROW_STORE_SCHEMA_VERSION, REPLICA_SINGLETON_ROW_ID } from "./row-store-schema";

export type ReplicaRowKind = "agent" | "workspace" | "project" | "timeline" | "checkpoint";

export interface ReplicaRowKey {
  serverId: string;
  kind: ReplicaRowKind;
  id: string;
}

export interface ReplicaRow extends ReplicaRowKey {
  payload: string;
}

/** Exact persisted payload, or null when this compound key must be absent. */
export interface ReplicaRowExpectation extends ReplicaRowKey {
  payload: string | null;
}

export interface ReplicaRowChanges {
  upserts: ReplicaRow[];
  deletes: ReplicaRowKey[];
}

export interface ReplicaHostRows {
  serverId: string;
  rows: ReplicaRow[];
}

export interface ReplicaRowStore {
  open(): Promise<void>;
  read(
    serverId: string,
    kinds: readonly ReplicaRowKind[],
    ids?: readonly string[],
  ): Promise<ReplicaRow[]>;
  readAll(): Promise<ReplicaHostRows[]>;
  apply(changes: ReplicaRowChanges): Promise<void>;
  /** Compare all expectations and mutate in one transaction; false commits no changes. */
  applyIfUnchanged(
    changes: ReplicaRowChanges,
    expected: readonly ReplicaRowExpectation[],
  ): Promise<boolean>;
  deleteHost(serverId: string): Promise<void>;
  renameHost(oldServerId: string, newServerId: string): Promise<void>;
  clear(): Promise<void>;
}
