import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppSettingsStore } from "./index.js";
const homes: string[] = [];
afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
});
async function createStore() {
  const home = await mkdtemp(join(tmpdir(), "settings-sync-"));
  homes.push(home);
  return { home, store: new AppSettingsStore(home) };
}
const theme = (value: string, expectedRevision = 0) => ({
  path: ["app", "theme"],
  value,
  expectedRevision,
});
describe("host app settings authority", () => {
  it("requires explicit initialization and retains independent hosts", async () => {
    const a = await createStore();
    const b = await createStore();
    expect((await a.store.read()).initialized).toBe(false);
    await expect(a.store.patch([theme("dark")])).rejects.toThrow("initialize");
    await a.store.patch([theme("dark")], true);
    expect((await b.store.read()).initialized).toBe(false);
    expect((await new AppSettingsStore(a.home).read()).values).toEqual({ app: { theme: "dark" } });
    expect((await a.store.patch([theme("light")], true)).conflicts).toEqual([["app", "theme"]]);
  });
  it("merges concurrent different leaves and rejects same-field conflicts atomically", async () => {
    const { store } = await createStore();
    await store.patch([theme("dark")], true);
    const results = await Promise.all([
      store.patch([theme("light", 1)]),
      store.patch([{ path: ["app", "language"], value: "fr", expectedRevision: 0 }]),
    ]);
    expect(results.every((result) => !result.conflicts.length)).toBe(true);
    const before = await store.read();
    const result = await store.patch([
      theme("auto", 1),
      { path: ["app", "language"], value: "en", expectedRevision: 3 },
    ]);
    expect(result.conflicts).toEqual([["app", "theme"]]);
    expect(await store.read()).toEqual(before);
  });
  it("preserves newer unknown preferences while an older client changes a known leaf", async () => {
    const { home, store } = await createStore();
    await writeFile(
      join(home, "app-settings.json"),
      JSON.stringify({
        initialized: true,
        revision: 4,
        values: {
          future: { enabled: true },
          app: { theme: "dark", paseoPlusPlus: { previousAgents: true, futureFlag: false } },
        },
        fieldRevisions: {},
      }),
    );
    await store.patch([
      { path: ["app", "paseoPlusPlus", "previousAgents"], value: false, expectedRevision: 0 },
    ]);
    expect((await store.read()).values).toEqual({
      future: { enabled: true },
      app: { theme: "dark", paseoPlusPlus: { previousAgents: false, futureFlag: false } },
    });
  });
  it("rejects credentials, unsafe and overlapping paths without writes", async () => {
    const { store } = await createStore();
    for (const path of [
      ["app", "password"],
      ["connections", "token"],
      ["app", "paseoPlusPlus", "__proto__"],
    ])
      await expect(
        store.patch([{ path, value: "secret", expectedRevision: 0 }], true),
      ).rejects.toThrow();
    await expect(store.patch([theme("dark"), theme("light")], true)).rejects.toThrow("Overlapping");
    expect((await store.read()).initialized).toBe(false);
  });
  it("does not publish or acknowledge failed durable writes, and releases the queue", async () => {
    const { home } = await createStore();
    const store = new AppSettingsStore(home, async () => {
      throw new Error("disk full");
    });
    const changes: unknown[] = [];
    store.subscribe((value) => changes.push(value));
    await expect(store.patch([theme("dark")], true)).rejects.toThrow("disk full");
    expect(changes).toEqual([]);
    expect((await store.read()).initialized).toBe(false);
  });
  it("never treats corruption as an empty host", async () => {
    const { home, store } = await createStore();
    await writeFile(join(home, "app-settings.json"), "bad json");
    await expect(store.read()).rejects.toThrow();
    await expect(store.patch([theme("dark")], true)).rejects.toThrow();
  });
});

it("rejects Usage host selection and parent replacement while preserving historical host data", async () => {
  const { home, store } = await createStore();
  await writeFile(
    join(home, "app-settings.json"),
    JSON.stringify({
      initialized: true,
      revision: 1,
      values: {
        app: { usage: { serverId: "legacy-host", displayAs: "used", futureChoice: true } },
      },
      fieldRevisions: {},
    }),
  );
  for (const patch of [
    { path: ["app", "usage", "serverId"], value: "other-host", expectedRevision: 0 },
    { path: ["app", "usage"], value: null, expectedRevision: 0 },
  ])
    await expect(store.patch([patch])).rejects.toThrow("Usage host selection");
  await store.patch([
    { path: ["app", "usage", "displayAs"], value: "remaining", expectedRevision: 0 },
  ]);
  expect((await store.read()).values).toEqual({
    app: { usage: { serverId: "legacy-host", displayAs: "remaining", futureChoice: true } },
  });
});

it("durably stores accent choices alongside independent appearance preferences", async () => {
  const { home, store } = await createStore();
  await store.patch(
    [theme("auto"), { path: ["app", "accentColor"], value: "purple", expectedRevision: 0 }],
    true,
  );
  await store.patch([theme("light", 1)]);
  expect((await new AppSettingsStore(home).read()).values).toEqual({
    app: { theme: "light", accentColor: "purple" },
  });
});

it("stores independent sidebar profile leaves atomically without removing legacy client fields", async () => {
  const { home, store } = await createStore();
  await store.patch(
    [
      { path: ["sidebar", "sortMode"], value: "custom", expectedRevision: 0 },
      { path: ["sidebar", "groupMode"], value: "project", expectedRevision: 0 },
    ],
    true,
  );
  const result = await store.patch([
    {
      path: ["sidebar", "modeProfiles", "project", "initialWorkspaceCount"],
      value: 37,
      expectedRevision: 0,
    },
    {
      path: ["sidebar", "modeProfiles", "status", "initialWorkspaceCount"],
      value: null,
      expectedRevision: 0,
    },
    {
      path: ["sidebar", "modeProfiles", "status", "workspaceUpdatedWithinDays"],
      value: 3,
      expectedRevision: 0,
    },
    {
      path: ["sidebar", "modeProfiles", "status", "sidebarRowItems", "host"],
      value: false,
      expectedRevision: 0,
    },
    { path: ["sidebar", "groupMode"], value: "status", expectedRevision: 1 },
  ]);
  expect(result.conflicts).toEqual([]);
  expect((await new AppSettingsStore(home).read()).values).toEqual({
    sidebar: {
      sortMode: "custom",
      groupMode: "status",
      modeProfiles: {
        project: { initialWorkspaceCount: 37 },
        status: {
          initialWorkspaceCount: null,
          workspaceUpdatedWithinDays: 3,
          sidebarRowItems: { host: false },
        },
      },
    },
  });
});
