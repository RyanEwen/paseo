import {
  IDBKeyRange as FakeIDBKeyRange,
  IDBObjectStore as FakeIDBObjectStore,
  indexedDB as fakeIndexedDb,
} from "fake-indexeddb";
import { expect, it, vi } from "vitest";
import { runReplicaRowStoreContract } from "./row-store.contract";
import { createIndexedDbReplicaRowStore } from "./row-store.web";

globalThis.indexedDB = fakeIndexedDb;
globalThis.IDBKeyRange = FakeIDBKeyRange;

let databaseSequence = 0;

runReplicaRowStoreContract("IndexedDB", async () => {
  const databaseName = `replica-row-store-test-${databaseSequence++}`;
  return {
    store: createIndexedDbReplicaRowStore({ databaseName, schemaVersion: 1 }),
    async openWithSchemaVersion(schemaVersion) {
      const store = createIndexedDbReplicaRowStore({ databaseName, schemaVersion });
      await store.open();
      return store;
    },
  };
});

it("uses exact IndexedDB keys for targeted rows instead of scanning the host", async () => {
  const store = createIndexedDbReplicaRowStore({
    databaseName: `replica-row-store-targeted-${databaseSequence++}`,
    schemaVersion: 1,
  });
  await store.open();
  await store.apply({
    upserts: [
      { serverId: "server-a", kind: "agent", id: "agent-1", payload: "agent" },
      { serverId: "server-a", kind: "workspace", id: "workspace-1", payload: "workspace" },
    ],
    deletes: [],
  });
  const get = vi.spyOn(FakeIDBObjectStore.prototype, "get");
  const getAll = vi.spyOn(FakeIDBObjectStore.prototype, "getAll");

  expect(await store.read("server-a", ["agent"], ["agent-1"])).toEqual([
    { serverId: "server-a", kind: "agent", id: "agent-1", payload: "agent" },
  ]);
  expect(get).toHaveBeenCalledWith(["server-a", "agent", "agent-1"]);
  expect(getAll).not.toHaveBeenCalled();

  get.mockRestore();
  getAll.mockRestore();
});

it.each([null, undefined])(
  "does not mistake a present malformed payload %s for an absent key",
  async (payload) => {
    const store = createIndexedDbReplicaRowStore({
      databaseName: `replica-row-store-malformed-${databaseSequence++}`,
      schemaVersion: 1,
    });
    await store.open();
    const row = {
      serverId: "server-a",
      kind: "checkpoint" as const,
      id: "singleton",
      payload: payload as unknown as string,
    };
    await store.apply({ upserts: [row], deletes: [] });
    expect(
      await store.applyIfUnchanged({ deletes: [row], upserts: [] }, [{ ...row, payload: null }]),
    ).toBe(false);
    expect(await store.read("server-a", ["checkpoint"])).toEqual([row]);
  },
);
