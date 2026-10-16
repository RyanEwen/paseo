import { bindSettingsHost } from "./binding";
import { createSettingsHostTransport } from "./transport";
import { normalizeRemoteSidebarModes } from "./sidebar-values";
import { createSyncedSidebarSettingsSave } from "./sidebar-edits";
import {
  exportLegacySidebarPresentation,
  defaultSidebarModeProfiles,
  defaultSidebarLocalModeFilters,
} from "@/stores/sidebar-mode-preferences";
import {
  useSidebarViewStore,
  projectSidebarMode,
  type SidebarViewStoreState,
} from "@/stores/sidebar-view-store";
import {
  selectAccentColorSupport,
  exportSupportedAccentSettings,
} from "@/appearance/accent-support";
import { ServerInfoStatusPayloadSchema } from "@getpaseo/protocol/messages";
import { QueryClient } from "@tanstack/react-query";
import {
  APP_SETTINGS_QUERY_KEY,
  DEFAULT_CLIENT_SETTINGS,
  normalizeAppSettings,
  type AppSettings,
} from "@/hooks/use-settings/storage";
import { createSyncedAppSettingsSave } from "./app-edits";
import { describe, expect, it } from "vitest";
import { SettingsSyncModel, type SettingsSyncTransport } from "./model";
import type { AppSettingsSnapshot, AppSettingsPatch } from "@getpaseo/protocol/app-settings";
import { applySettingsPatches, settingsDiff } from "@getpaseo/protocol/app-settings-values";

function snapshot(theme: string | null, revision = 1): AppSettingsSnapshot {
  return {
    initialized: theme !== null,
    revision: theme === null ? 0 : revision,
    values: theme === null ? {} : { app: { theme } },
    fieldRevisions: theme === null ? {} : { '["app","theme"]': revision },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function setup() {
  let saved: unknown = null;
  let device: Record<string, unknown> = { app: { theme: "device" } };
  const applied: unknown[] = [];
  const model = new SettingsSyncModel({
    readLocal: async () => saved,
    writeLocal: async (value) => {
      saved = structuredClone(value);
    },
    getDeviceValues: async () => device,
    applyValues: async (values) => {
      device = structuredClone(values);
      applied.push(device);
    },
  });
  return { model, applied, device: () => device, saved: () => saved };
}
function host(initial: AppSettingsSnapshot) {
  let remote = initial;
  const writes: { patches: AppSettingsPatch[]; initialize: boolean }[] = [];
  const transport: SettingsSyncTransport = {
    supported: true,
    writable: true,
    read: async () => structuredClone(remote),
    patch: async (patches, initialize) => {
      writes.push({ patches: structuredClone(patches), initialize });
      remote = {
        initialized: true,
        revision: remote.revision + 1,
        values: applySettingsPatches(remote.values, patches),
        fieldRevisions: Object.fromEntries(
          patches.map((patch) => [JSON.stringify(patch.path), remote.revision + 1]),
        ),
      };
      return { snapshot: structuredClone(remote), conflicts: [] };
    },
  };
  return { transport, writes, read: () => remote };
}
async function editTheme(model: SettingsSyncModel, before: string, after: string) {
  await model.edit(
    settingsDiff({ app: { theme: before } }, { app: { theme: after } }, model.getSnapshot()),
  );
}

describe("settings host policy", () => {
  it("reads initialized hosts before adoption and never publishes local settings on selection", async () => {
    const { model, device } = setup();
    const a = host(snapshot("dark"));
    const b = host(snapshot("light"));
    await model.load();
    await model.selectHost("A");
    await model.connect("A", a.transport);
    await model.selectHost("B");
    await model.connect("B", b.transport);
    expect(device()).toEqual({ app: { theme: "light" } });
    expect(a.writes).toEqual([]);
    expect(b.writes).toEqual([]);
  });
  it("keeps offline A edits attached to A through A-to-B-to-A switching", async () => {
    const { model, device, saved } = setup();
    const a = host(snapshot("dark"));
    const b = host(snapshot("light"));
    await model.load();
    await model.selectHost("A");
    await model.connect("A", a.transport);
    await model.connect("A", null);
    await editTheme(model, "dark", "auto");
    await model.selectHost("B");
    await model.connect("B", b.transport);
    expect(b.writes).toEqual([]);
    expect(b.read().values).toEqual({ app: { theme: "light" } });
    expect(saved()).toMatchObject({
      selectedHost: "B",
      hosts: { A: { pending: [{ path: ["app", "theme"], value: "auto" }] } },
    });
    await model.selectHost("A");
    await model.connect("A", a.transport);
    expect(device()).toEqual({ app: { theme: "auto" } });
    expect(a.writes).toHaveLength(1);
    expect(b.writes).toEqual([]);
  });
  it("fences a stale A read while B is selected", async () => {
    const { model, device } = setup();
    const stale = deferred<AppSettingsSnapshot>();
    const a = host(snapshot("dark"));
    const b = host(snapshot("light"));
    await model.load();
    await model.selectHost("A");
    const reading = model.connect("A", { ...a.transport, read: () => stale.promise });
    await model.selectHost("B");
    await model.connect("B", b.transport);
    stale.resolve(snapshot("dark"));
    await reading;
    expect(device()).toEqual({ app: { theme: "light" } });
    expect(model.getState().selectedHost).toBe("B");
    expect(b.writes).toEqual([]);
  });
  it("fences an in-flight A save completion and preserves B without writing it", async () => {
    const { model, device } = setup();
    const completion = deferred<{ snapshot: AppSettingsSnapshot; conflicts: string[][] }>();
    const a = host(snapshot("dark"));
    const b = host(snapshot("light"));
    await model.load();
    await model.selectHost("A");
    await model.connect("A", { ...a.transport, patch: () => completion.promise });
    await editTheme(model, "dark", "auto");
    const saving = model.flush();
    await model.selectHost("B");
    const connectingB = model.connect("B", b.transport);
    completion.resolve({ snapshot: snapshot("auto", 2), conflicts: [] });
    await saving;
    await connectingB;
    expect(device()).toEqual({ app: { theme: "light" } });
    expect(b.writes).toEqual([]);
  });
  it("requires an explicit publish on an empty host and blocks ordinary editing", async () => {
    const { model, device } = setup();
    const empty = host(snapshot(null));
    await model.load();
    await model.selectHost("empty");
    await model.connect("empty", empty.transport);
    expect(model.getState().status).toBe("empty");
    expect(empty.writes).toEqual([]);
    await expect(editTheme(model, "device", "dark")).rejects.toThrow("Load");
    expect(device()).toEqual({ app: { theme: "device" } });
    await model.publishDeviceSettings();
    expect(empty.writes).toEqual([
      {
        initialize: true,
        patches: [{ path: ["app", "theme"], value: "device", expectedRevision: 0 }],
      },
    ]);
  });
  it("does not write after a failed read or against an unsupported host", async () => {
    const { model } = setup();
    const a = host(snapshot("dark"));
    await model.load();
    await model.selectHost("A");
    await model.connect("A", {
      ...a.transport,
      read: async () => {
        throw new Error("read failed");
      },
    });
    expect(model.getState().status).toBe("error");
    await expect(editTheme(model, "device", "light")).rejects.toThrow();
    await model.connect("A", { ...a.transport, supported: false });
    expect(model.getState().status).toBe("unsupported");
    expect(a.writes).toEqual([]);
  });
  it("blocks offline edits on a destination which has not been read", async () => {
    const { model } = setup();
    await model.load();
    await model.selectHost("A");
    await model.connect("A", null);
    await expect(editTheme(model, "device", "dark")).rejects.toThrow("Load");
    expect(model.getState().status).toBe("reading");
  });
  it("surfaces concurrent same-field conflicts, retains the outbox and resolves only explicitly", async () => {
    const { model, saved } = setup();
    const a = host(snapshot("dark"));
    const conflicting = {
      ...a.transport,
      read: async () => snapshot("light", 2),
      patch: async () => ({ snapshot: snapshot("light", 2), conflicts: [["app", "theme"]] }),
    };
    await model.load();
    await model.selectHost("A");
    await model.connect("A", a.transport);
    await model.connect("A", null);
    await editTheme(model, "dark", "auto");
    await model.connect("A", conflicting);
    await model.flush();
    expect(model.getState().status).toBe("conflict");
    expect(saved()).toMatchObject({
      hosts: { A: { pending: [{ value: "auto", expectedRevision: 1 }] } },
    });
    await model.useHostSettings();
    expect(model.getState().pendingCount).toBe(0);
  });
  it("restarts from durable host selection and outbox without seeding the host", async () => {
    const first = setup();
    const a = host(snapshot("dark"));
    await first.model.load();
    await first.model.selectHost("A");
    await first.model.connect("A", a.transport);
    await first.model.connect("A", null);
    await editTheme(first.model, "dark", "auto");
    const second = new SettingsSyncModel({
      readLocal: async () => first.saved(),
      writeLocal: async () => {},
      getDeviceValues: async () => ({ app: { theme: "device" } }),
      applyValues: async () => {},
    });
    await second.load();
    expect(second.getState().selectedHost).toBe("A");
    await second.connect("A", a.transport);
    expect(a.writes).toHaveLength(1);
    expect(a.writes[0]!.initialize).toBe(false);
  });
});

it("blocks writes through a read-only connection and preserves the host", async () => {
  const { model, device } = setup();
  const a = host(snapshot("dark"));
  await model.load();
  await model.selectHost("A");
  await model.connect("A", { ...a.transport, writable: false });
  expect(model.getState().status).toBe("readonly");
  expect(device()).toEqual({ app: { theme: "dark" } });
  await expect(editTheme(model, "dark", "light")).rejects.toThrow();
  expect(a.writes).toEqual([]);
});

it("restores the device backup without writing or deleting a host's pending edits", async () => {
  const { model, device, saved } = setup();
  const a = host(snapshot("dark"));
  await model.load();
  await model.selectHost("A");
  await model.connect("A", a.transport);
  await model.connect("A", null);
  await editTheme(model, "dark", "auto");
  await model.restoreDeviceSettings();
  expect(model.getState().status).toBe("local");
  expect(device()).toEqual({ app: { theme: "device" } });
  expect(a.writes).toEqual([]);
  expect(saved()).toMatchObject({
    selectedHost: null,
    hosts: { A: { pending: [{ value: "auto" }] } },
  });
});

it("reads before resolving conflicts and retains pending edits if that read fails", async () => {
  const { model, saved } = setup();
  const a = host(snapshot("dark"));
  let failRead = false;
  const transport = {
    ...a.transport,
    read: async () => {
      if (failRead) throw new Error("offline");
      return a.read();
    },
  };
  await model.load();
  await model.selectHost("A");
  await model.connect("A", transport);
  await model.connect("A", null);
  await editTheme(model, "dark", "auto");
  failRead = true;
  await model.connect("A", transport);
  await expect(model.useHostSettings()).rejects.toThrow("offline");
  expect(saved()).toMatchObject({ hosts: { A: { pending: [{ value: "auto" }] } } });
  expect(a.writes).toEqual([]);
});

it("rebases a second same-field edit after its own earlier in-flight write", async () => {
  const { model, device } = setup();
  const firstSave = deferred<{ snapshot: AppSettingsSnapshot; conflicts: string[][] }>();
  const a = host(snapshot("dark"));
  let calls = 0;
  const transport = {
    ...a.transport,
    patch: async (patches: AppSettingsPatch[], initialize: boolean) => {
      calls += 1;
      if (calls === 1) return firstSave.promise;
      expect(patches[0]!.expectedRevision).toBe(2);
      return a.transport.patch(patches, initialize);
    },
  };
  await model.load();
  await model.selectHost("A");
  await model.connect("A", transport);
  await editTheme(model, "dark", "light");
  await editTheme(model, "light", "auto");
  firstSave.resolve({ snapshot: snapshot("light", 2), conflicts: [] });
  await model.flush();
  expect(calls).toBe(2);
  expect(device()).toEqual({ app: { theme: "auto" } });
  expect(model.getState().pendingCount).toBe(0);
});

it("keeps A pending edits and ignores its late save after returning to A from B", async () => {
  const { model, device } = setup();
  const completion = deferred<{ snapshot: AppSettingsSnapshot; conflicts: string[][] }>();
  const a = host(snapshot("dark"));
  const b = host(snapshot("light"));
  await model.load();
  await model.selectHost("A");
  await model.connect("A", { ...a.transport, patch: () => completion.promise });
  await editTheme(model, "dark", "auto");
  await model.selectHost("B");
  const readingB = model.connect("B", b.transport);
  await model.selectHost("A");
  const readingA = model.connect("A", a.transport);
  completion.resolve({ snapshot: snapshot("auto", 2), conflicts: [] });
  await readingB;
  await readingA;
  await model.flush();
  expect(model.getState().selectedHost).toBe("A");
  expect(model.getState().pendingCount).toBe(0);
  expect(device()).toEqual({ app: { theme: "auto" } });
  expect(b.writes).toEqual([]);
});

it("does not project defaults after sync configuration fails to load", async () => {
  const applied: unknown[] = [];
  const model = new SettingsSyncModel({
    readLocal: async () => {
      throw new Error("storage unavailable");
    },
    writeLocal: async () => {},
    getDeviceValues: async () => ({ app: { theme: "dark" } }),
    applyValues: async (value) => {
      applied.push(value);
    },
  });
  await model.load();
  expect(model.getState().status).toBe("error");
  expect(applied).toEqual([]);
});

it("evaluates queued functional app edits against the latest durable settings", async () => {
  const queryClient = new QueryClient();
  const model = new SettingsSyncModel({
    readLocal: async () => null,
    writeLocal: async () => {},
    getDeviceValues: async () => ({ app: DEFAULT_CLIENT_SETTINGS }),
    applyValues: async (values) => {
      queryClient.setQueryData(APP_SETTINGS_QUERY_KEY, normalizeAppSettings(values.app));
    },
  });
  const a = host({
    initialized: true,
    revision: 1,
    values: { app: DEFAULT_CLIENT_SETTINGS },
    fieldRevisions: {},
  });
  await model.load();
  await model.selectHost("A");
  await model.connect("A", a.transport);
  await model.connect("A", null);
  const save = createSyncedAppSettingsSave(model, async () => DEFAULT_CLIENT_SETTINGS);
  await Promise.all([
    save(queryClient, (current) => ({ autoExpandReasoning: !current.autoExpandReasoning })),
    save(queryClient, (current) => ({ autoExpandReasoning: !current.autoExpandReasoning })),
  ]);
  expect(queryClient.getQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY)?.autoExpandReasoning).toBe(
    false,
  );
  expect(a.writes).toEqual([]);
  queryClient.clear();
});

it("fences a queued app edit while its old host's local settings are still loading", async () => {
  const queryClient = new QueryClient();
  const loading = deferred<AppSettings>();
  const { model } = setup();
  const a = host(snapshot("dark"));
  const b = host(snapshot("light"));
  await model.load();
  await model.selectHost("A");
  await model.connect("A", a.transport);
  const save = createSyncedAppSettingsSave(model, () => loading.promise);
  const saving = save(queryClient, { theme: "auto" });
  // Attach rejection handling before resolving the deliberately delayed read.
  const rejected = expect(saving).rejects.toThrow("Settings host changed");
  await model.selectHost("B");
  await model.connect("B", b.transport);
  loading.resolve(DEFAULT_CLIENT_SETTINGS);
  await rejected;
  expect(b.writes).toEqual([]);
  expect(model.getState().selectedHost).toBe("B");
  queryClient.clear();
});

it("retains an explicit initialization candidate if another client initializes the host first", async () => {
  const { model, saved } = setup();
  const a = host(snapshot(null));
  const transport = {
    ...a.transport,
    patch: async () => ({ snapshot: snapshot("other-device"), conflicts: [["app", "theme"]] }),
  };
  await model.load();
  await model.selectHost("A");
  await model.connect("A", transport);
  await model.publishDeviceSettings();
  expect(model.getState().status).toBe("conflict");
  expect(saved()).toMatchObject({
    hosts: {
      A: {
        pending: [{ path: ["app", "theme"], value: "device", expectedRevision: 0 }],
        backup: { app: { theme: "device" } },
      },
    },
  });
});

it("syncs Usage display and footer visibility while each client keeps its own report host", async () => {
  const client = new QueryClient();
  client.setQueryData(APP_SETTINGS_QUERY_KEY, {
    ...DEFAULT_CLIENT_SETTINGS,
    usage: { ...DEFAULT_CLIENT_SETTINGS.usage, serverId: "device-host" },
  });
  let saved: unknown = null;
  const model = new SettingsSyncModel({
    readLocal: async () => null,
    writeLocal: async (value) => {
      saved = structuredClone(value);
    },
    getDeviceValues: async () => ({ app: DEFAULT_CLIENT_SETTINGS }),
    applyValues: async (values) => {
      const current = client.getQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY)!;
      const incoming = normalizeAppSettings(values.app);
      client.setQueryData(APP_SETTINGS_QUERY_KEY, {
        ...incoming,
        usage: { ...incoming.usage, serverId: current.usage.serverId },
      });
    },
  });
  const a = host({
    initialized: true,
    revision: 1,
    values: {
      app: {
        usage: { displayAs: "remaining", pins: null, serverId: "historical-remote-host" },
        sidebarFooterItems: [{ key: "usage", visible: true }],
      },
    },
    fieldRevisions: {},
  });
  await model.load();
  await model.selectHost("A");
  await model.connect("A", a.transport);
  const adopted = client.getQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY)!;
  expect(adopted.usage).toMatchObject({ displayAs: "remaining", serverId: "device-host" });
  expect(adopted.sidebarFooterItems).toEqual([{ key: "usage", visible: true }]);
  const save = createSyncedAppSettingsSave(
    model,
    async () => DEFAULT_CLIENT_SETTINGS,
    async (_query, serverId) => {
      client.setQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY, (current) => ({
        ...current!,
        usage: { ...current!.usage, serverId },
      }));
    },
  );
  await save(client, (current) => ({
    usage: { ...current.usage, serverId: "another-device-host" },
  }));
  expect(a.writes).toEqual([]);
  await save(client, (current) => ({
    usage: { ...current.usage, displayAs: "used" },
    sidebarFooterItems: [{ key: "usage", visible: false }],
  }));
  await model.flush();
  expect(a.writes.flatMap((write) => write.patches).map((patch) => patch.path)).toEqual([
    ["app", "sidebarFooterItems"],
    ["app", "usage", "displayAs"],
  ]);
  expect(client.getQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY)?.usage.serverId).toBe(
    "another-device-host",
  );
  expect(a.read().values).toMatchObject({
    app: {
      usage: { displayAs: "used", serverId: "historical-remote-host" },
      sidebarFooterItems: [{ key: "usage", visible: false }],
    },
  });
  expect(saved).toMatchObject({ hosts: { A: { pending: [] } } });
  client.clear();
});

it("never publishes or sends an edit when the durable outbox write fails", async () => {
  let failWrite = false;
  let applied: Record<string, unknown> = { app: { theme: "device" } };
  const model = new SettingsSyncModel({
    readLocal: async () => null,
    writeLocal: async () => {
      if (failWrite) throw new Error("disk unavailable");
    },
    getDeviceValues: async () => applied,
    applyValues: async (value) => {
      applied = value;
    },
  });
  const a = host(snapshot("dark"));
  await model.load();
  await model.selectHost("A");
  await model.connect("A", a.transport);
  await model.connect("A", null);
  failWrite = true;
  await expect(editTheme(model, "dark", "light")).rejects.toThrow("disk unavailable");
  expect(applied).toEqual({ app: { theme: "dark" } });
  expect(a.writes).toEqual([]);
  expect(model.getState().status).toBe("error");
  failWrite = false;
  await model.connect("A", a.transport);
  await editTheme(model, "dark", "light");
  await model.flush();
  expect(a.writes).toHaveLength(1);
  expect(applied).toEqual({ app: { theme: "light" } });
});

describe("accent settings compatibility", () => {
  const oldInfo = ServerInfoStatusPayloadSchema.parse({
    status: "server_info",
    serverId: "old",
    features: { appSettingsSync: true },
  });
  const newInfo = ServerInfoStatusPayloadSchema.parse({
    status: "server_info",
    serverId: "new",
    features: { appSettingsSync: true, appSettingsAccentColor: true },
  });
  const sessions = { old: { serverInfo: oldInfo }, new: { serverInfo: newInfo } };

  it("enables local and capable host choices, blocking an older or unknown selected host", () => {
    expect(selectAccentColorSupport({ sessions }, null)).toBe(true);
    expect(selectAccentColorSupport({ sessions }, "new")).toBe(true);
    expect(selectAccentColorSupport({ sessions }, "old")).toBe(false);
    expect(selectAccentColorSupport({ sessions }, "missing")).toBe(false);
  });

  it("omits only accent from explicit initialization for an older host", () => {
    const app = { ...DEFAULT_CLIENT_SETTINGS, accentColor: "purple", future: { preserved: true } };
    const { accentColor: _accent, ...rest } = app;
    const olderExport = exportSupportedAccentSettings(
      app,
      selectAccentColorSupport({ sessions }, "old"),
    );
    expect(olderExport).toEqual(rest);
    expect(app.accentColor).toBe("purple");
    expect(
      exportSupportedAccentSettings(app, selectAccentColorSupport({ sessions }, "new")),
    ).toEqual(app);
    expect(
      exportSupportedAccentSettings(app, selectAccentColorSupport({ sessions }, null)),
    ).toEqual(app);
  });

  it("retains a queued accent for its original host when selecting an older host", async () => {
    const { model, saved, device } = setup();
    const a = host({
      ...snapshot("dark"),
      values: { app: { theme: "dark", accentColor: "default" } },
    });
    const b = host(snapshot("light"));
    await model.load();
    await model.selectHost("A");
    await model.connect("A", a.transport);
    await model.connect("A", null);
    await model.edit([{ path: ["app", "accentColor"], value: "blue", expectedRevision: 0 }]);
    await model.selectHost("B");
    await model.connect("B", b.transport);
    expect(b.writes).toEqual([]);
    expect(saved()).toMatchObject({
      hosts: { A: { pending: [{ path: ["app", "accentColor"], value: "blue" }] } },
    });
    await model.selectHost("A");
    await model.connect("A", a.transport);
    expect(device()).toEqual({ app: { theme: "dark", accentColor: "blue" } });
    expect(a.writes).toHaveLength(1);
    expect(b.writes).toEqual([]);
  });
});

it("backs up the full accent choice while publishing only supported fields, then restores it", async () => {
  let device: Record<string, unknown> = { app: { theme: "dark", accentColor: "purple" } };
  const original = structuredClone(device);
  const purposes: string[] = [];
  const older = host(snapshot(null));
  const model = new SettingsSyncModel({
    readLocal: async () => null,
    writeLocal: async () => {},
    getDeviceValues: async (purpose) => {
      purposes.push(purpose);
      if (purpose === "backup") return structuredClone(device);
      return {
        app: exportSupportedAccentSettings({ theme: "dark", accentColor: "purple" }, false),
      };
    },
    applyValues: async (values) => {
      device = structuredClone(values);
    },
  });
  await model.load();
  await model.selectHost("older");
  await model.connect("older", older.transport);
  await model.publishDeviceSettings();
  expect(older.read().values).toEqual({ app: { theme: "dark" } });
  expect(purposes).toEqual(["backup", "publish"]);
  await model.restoreDeviceSettings();
  expect(device).toEqual(original);
  expect(older.writes).toHaveLength(1);
});

describe("sidebar mode command transactions", () => {
  function sidebarHarness() {
    let sidebar = {
      ...useSidebarViewStore.getState(),
      ...projectSidebarMode({
        groupMode: "project",
        modeProfiles: defaultSidebarModeProfiles(),
        localModeFilters: defaultSidebarLocalModeFilters(),
      }),
      modeProfilesInitialized: true,
    };
    let writer: () => Promise<void> = async () => {};
    let supported = true;
    const model = new SettingsSyncModel({
      readLocal: async () => null,
      writeLocal: async () => writer(),
      getDeviceValues: async () => ({
        sidebar: { groupMode: sidebar.groupMode, modeProfiles: sidebar.modeProfiles },
      }),
      applyValues: async (values) => {
        const projected = normalizeRemoteSidebarModes(values.sidebar, DEFAULT_CLIENT_SETTINGS);
        sidebar = {
          ...sidebar,
          ...projectSidebarMode({ ...projected, localModeFilters: sidebar.localModeFilters }),
          modeProfilesInitialized: true,
        };
      },
    });
    const store = {
      getState: () => sidebar,
      setState: (patch: Partial<SidebarViewStoreState>) => {
        sidebar = { ...sidebar, ...patch };
      },
    };
    return {
      model,
      store,
      save: createSyncedSidebarSettingsSave(model, store, () => supported),
      setWriter: (next: () => Promise<void>) => {
        writer = next;
      },
      setSupported: (next: boolean) => {
        supported = next;
      },
    };
  }
  it("syncs the accordion choice only in the project profile and retains it on remote normalization", async () => {
    const harness = sidebarHarness();
    const remote = host(snapshot("dark"));
    await harness.model.load();
    await harness.model.selectHost("A");
    await harness.model.connect("A", remote.transport);
    await harness.save((current) => ({ oneProjectAtATime: !current.oneProjectAtATime }), "project");
    expect(remote.read().values).toMatchObject({
      sidebar: {
        modeProfiles: {
          project: { oneProjectAtATime: true },
          status: { oneProjectAtATime: false },
        },
      },
    });
    const normalized = normalizeRemoteSidebarModes(
      remote.read().values.sidebar,
      DEFAULT_CLIENT_SETTINGS,
    );
    expect(normalized.modeProfiles.project.oneProjectAtATime).toBe(true);
    expect(normalized.modeProfiles.status.oneProjectAtATime).toBe(false);
  });

  it("keeps queued old-visible-mode preferences attached to their original mode", async () => {
    const { model, save, store } = sidebarHarness();
    await model.load();
    await Promise.all([
      save({ groupMode: "status" }),
      save({ sortMode: "project", initialWorkspaceCount: 7 }),
    ]);
    expect(store.getState()).toMatchObject({
      groupMode: "status",
      sortMode: "status",
      initialWorkspaceCount: 20,
    });
    expect(store.getState().modeProfiles.project).toMatchObject({
      sortMode: "project",
      initialWorkspaceCount: 7,
    });
  });
  it("durably materializes both profiles before projection and preserves filters changed during the write", async () => {
    const harness = sidebarHarness();
    const remote = host({
      ...snapshot("dark"),
      values: { sidebar: { groupMode: "project", sortMode: "custom" } },
    });
    await harness.model.load();
    await harness.model.selectHost("A");
    await harness.model.connect("A", remote.transport);
    const held = deferred<void>();
    const writing = deferred<void>();
    harness.setWriter(async () => {
      writing.resolve();
      await held.promise;
    });
    const saving = harness.save({ groupMode: "status" });
    await writing.promise;
    expect(harness.store.getState().groupMode).toBe("project");
    const current = harness.store.getState();
    harness.store.setState({
      localModeFilters: {
        ...current.localModeFilters,
        status: { hostFilters: ["offline-host"], projectFilters: ["opaque"] },
      },
    });
    held.resolve();
    await saving;
    expect(harness.store.getState()).toMatchObject({
      groupMode: "status",
      hostFilters: ["offline-host"],
      projectFilters: ["opaque"],
    });
    expect(remote.writes[0].patches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ["sidebar", "groupMode"], value: "status" }),
        expect.objectContaining({
          path: ["sidebar", "modeProfiles", "project", "initialWorkspaceCount"],
          value: 20,
        }),
        expect.objectContaining({
          path: ["sidebar", "modeProfiles", "status", "initialWorkspaceCount"],
          value: 20,
        }),
      ]),
    );
    expect(remote.writes[0].patches.some((patch) => patch.path.includes("hostFilters"))).toBe(
      false,
    );
  });
  it("a failed durable write never changes the selected mode or restores older local facets", async () => {
    const harness = sidebarHarness();
    await harness.model.load();
    await harness.model.selectHost("A");
    await harness.model.connect("A", host(snapshot("dark")).transport);
    const failure = new Error("disk failed");
    harness.setWriter(async () => {
      throw failure;
    });
    const current = harness.store.getState();
    harness.store.setState(
      projectSidebarMode({
        ...current,
        localModeFilters: {
          ...current.localModeFilters,
          project: { hostFilters: ["new-choice"], projectFilters: [] },
        },
      }),
    );
    await expect(harness.save({ groupMode: "status" })).rejects.toBe(failure);
    expect(harness.store.getState()).toMatchObject({
      groupMode: "project",
      hostFilters: ["new-choice"],
    });
  });
  it("rejects unsupported authorities and stale queued edits after a host switch", async () => {
    const harness = sidebarHarness();
    await harness.model.load();
    harness.setSupported(false);
    await expect(harness.save({ groupMode: "status" })).rejects.toThrow("Update the settings host");
    harness.setSupported(true);
    const stale = harness.save({ groupMode: "status" });
    const switched = harness.model.selectHost("B");
    await expect(stale).rejects.toThrow("Settings host changed");
    await switched;
    expect(harness.store.getState().groupMode).toBe("project");
  });
  it("retains known profiles and unknown remote leaves through a subsequent edit", async () => {
    const harness = sidebarHarness();
    const modeProfiles = defaultSidebarModeProfiles();
    modeProfiles.status.initialWorkspaceCount = 37;
    const remote = host({
      ...snapshot("dark"),
      values: {
        sidebar: {
          groupMode: "status",
          futureSibling: { keep: true },
          modeProfiles: {
            ...modeProfiles,
            status: {
              ...modeProfiles.status,
              futureSetting: "keep",
              sidebarRowItems: { ...modeProfiles.status.sidebarRowItems, futureItem: true },
            },
          },
        },
      },
    });
    await harness.model.load();
    await harness.model.selectHost("A");
    await harness.model.connect("A", remote.transport);
    expect(harness.store.getState()).toMatchObject({
      groupMode: "status",
      initialWorkspaceCount: 37,
    });
    await harness.save({ initialWorkspaceCount: 7 });
    expect(remote.read().values).toMatchObject({
      sidebar: {
        futureSibling: { keep: true },
        modeProfiles: {
          status: {
            initialWorkspaceCount: 7,
            futureSetting: "keep",
            sidebarRowItems: { futureItem: true },
          },
        },
      },
    });
  });
  it("materializes a missing second profile while preserving the valid first profile and unknown leaves", async () => {
    const harness = sidebarHarness();
    const project = {
      ...defaultSidebarModeProfiles().project,
      initialWorkspaceCount: 37,
      workspaceTitleSource: "branch",
      futureSetting: true,
    };
    const remote = host({
      ...snapshot("dark"),
      values: { sidebar: { groupMode: "project", futureSibling: 1, modeProfiles: { project } } },
    });
    await harness.model.load();
    await harness.model.selectHost("A");
    await harness.model.connect("A", remote.transport);
    expect(harness.store.getState()).toMatchObject({
      initialWorkspaceCount: 37,
      workspaceTitleSource: "branch",
    });
    await harness.save({ showBackground: true });
    expect(remote.read().values).toMatchObject({
      sidebar: {
        futureSibling: 1,
        modeProfiles: {
          project: { initialWorkspaceCount: 37, futureSetting: true, showBackground: true },
          status: { initialWorkspaceCount: 20 },
        },
      },
    });
  });
  it.each([37, null])(
    "exports the active canonical count %s to legacy hosts rather than stale globals",
    (count) => {
      const profile = {
        ...defaultSidebarModeProfiles().status,
        initialWorkspaceCount: count,
        workspaceTitleSource: "branch" as const,
      };
      expect(DEFAULT_CLIENT_SETTINGS).toMatchObject({
        sidebarInitialWorkspaceCount: 20,
        workspaceTitleSource: "title",
      });
      expect(exportLegacySidebarPresentation(profile)).toMatchObject({
        sidebarInitialWorkspaceCount: count,
        workspaceTitleSource: "branch",
      });
      expect(exportLegacySidebarPresentation(profile)).not.toHaveProperty("modeProfiles");
    },
  );
});

describe("settings bootstrap load ownership", () => {
  it.each(["resolve", "reject"] as const)(
    "ignores an obsolete owner's late %s after the replacement load",
    async (settlement) => {
      const firstRead = deferred<unknown>();
      const secondRead = deferred<unknown>();
      let reads = 0;
      const model = new SettingsSyncModel({
        readLocal: () => (++reads === 1 ? firstRead.promise : secondRead.promise),
        writeLocal: async () => {},
        getDeviceValues: async () => ({}),
        applyValues: async () => {},
      });
      const first = new AbortController();
      const oldLoad = model.load(first.signal);
      first.abort();
      const newLoad = model.load();
      secondRead.resolve({ selectedHost: "H", hosts: {} });
      await newLoad;
      const before = model.getState();
      const emissions: unknown[] = [];
      const stop = model.subscribe(() => emissions.push(model.getState()));
      if (settlement === "resolve") firstRead.resolve({ selectedHost: null, hosts: {} });
      else firstRead.reject(new Error("obsolete read failed"));
      await oldLoad;
      stop();
      expect(model.getState()).toEqual(before);
      expect(model.getState()).toMatchObject({
        selectedHost: "H",
        status: "reading",
        canWrite: false,
      });
      expect(emissions).toEqual([]);
    },
  );
  it("does not let a pending load replace a newer explicit host selection", async () => {
    const pending = deferred<unknown>();
    const model = new SettingsSyncModel({
      readLocal: () => pending.promise,
      writeLocal: async () => {},
      getDeviceValues: async () => ({}),
      applyValues: async () => {},
    });
    const loading = model.load();
    await model.selectHost("chosen");
    pending.resolve({ selectedHost: null, hosts: {} });
    await loading;
    expect(model.getState()).toMatchObject({
      selectedHost: "chosen",
      status: "reading",
      canWrite: false,
    });
  });
});

describe("live settings authority", () => {
  function controlledClient() {
    type Client = Parameters<typeof bindSettingsHost>[0]["client"];
    let info = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "H",
      permissions: ["daemon.read"],
      features: { appSettingsSync: true },
    });
    const listeners = new Set<Parameters<Client["subscribeRawMessages"]>[0]>();
    const observations: { settle(theme?: string): void; released: boolean }[] = [];
    let writes = 0;
    const client: Client = {
      getLastServerInfoMessage: () => info,
      subscribeRawMessages: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      patchAppSettings: async () => {
        writes++;
        return { requestId: "patch", snapshot: snapshot("host"), conflicts: [] };
      },
      observeAppSettings: (options) => {
        const ready = deferred<Awaited<ReturnType<Client["observeAppSettings"]>["ready"]>>();
        const id = String(observations.length);
        const observation = {
          settle: (theme = "host") =>
            ready.resolve({ requestId: id, subscriptionId: id, snapshot: snapshot(theme) }),
          released: false,
        };
        const release = async () => {
          observation.released = true;
          options?.signal?.removeEventListener("abort", abort);
        };
        const abort = () => {
          void release();
        };
        options?.signal?.addEventListener("abort", abort, { once: true });
        observations.push(observation);
        return { subscriptionId: id, ready: ready.promise, subscribe: () => () => {}, release };
      },
    };
    return {
      client,
      observations,
      writes: () => writes,
      listenerCount: () => listeners.size,
      change(writable: boolean, supported = true) {
        info = ServerInfoStatusPayloadSchema.parse({
          ...info,
          permissions: writable ? ["daemon.read", "daemon.manage"] : ["daemon.read"],
          features: { appSettingsSync: supported },
        });
        for (const listener of listeners) listener({ type: "status", payload: info });
      },
    };
  }

  it("rebinds same-client permission changes and immediately gates a revoked writer", async () => {
    const { model } = setup();
    await model.load();
    await model.selectHost("H");
    const h = controlledClient();
    const connections: Promise<void>[] = [];
    const stop = bindSettingsHost({
      client: h.client,
      onSnapshot: (value) => {
        void model.receive("H", value);
      },
      onTransport: (transport) => {
        connections.push(model.connect("H", transport));
      },
    });
    h.observations[0].settle();
    await connections[0];
    expect(model.getState().status).toBe("readonly");
    const beforeRefresh = model.getState().pendingCount;
    h.change(true);
    expect(h.observations[0].released).toBe(true);
    h.observations[1].settle();
    await connections[1];
    expect(model.getState()).toMatchObject({ status: "ready", canWrite: true, selectedHost: "H" });
    expect(model.getState().pendingCount).toBe(beforeRefresh);
    h.change(true);
    expect(h.observations).toHaveLength(2);
    h.change(false);
    expect(model.getState().canWrite).toBe(false);
    h.observations[2].settle();
    await connections[2];
    expect(model.getState().status).toBe("readonly");
    expect(h.writes()).toBe(0);
    stop();
    h.change(true);
    expect(h.listenerCount()).toBe(0);
    expect(h.observations).toHaveLength(3);
    expect(h.observations[2].released).toBe(true);
  });

  it("resamples authority on explicit readonly refresh without publishing settings", async () => {
    const { model } = setup();
    await model.load();
    await model.selectHost("H");
    const h = controlledClient();
    const controller = new AbortController();
    const transport = createSettingsHostTransport({
      client: h.client,
      signal: controller.signal,
      onSnapshot: () => {},
    });
    const first = model.connect("H", transport);
    h.observations[0].settle();
    await first;
    const stillReadonly = model.retry();
    await Promise.resolve();
    h.observations[1].settle();
    await stillReadonly;
    expect(model.getState().status).toBe("readonly");
    h.change(true);
    const recovered = model.retry();
    await Promise.resolve();
    h.observations[2].settle();
    await recovered;
    expect(model.getState()).toMatchObject({
      status: "ready",
      canWrite: true,
      selectedHost: "H",
      pendingCount: 0,
    });
    expect(h.writes()).toBe(0);
    controller.abort();
  });

  it("rejects a replaced read's late completion and retires unsupported observations", async () => {
    const { model, applied } = setup();
    await model.load();
    await model.selectHost("H");
    const h = controlledClient(),
      connections: Promise<void>[] = [];
    const stop = bindSettingsHost({
      client: h.client,
      onSnapshot: (value) => {
        void model.receive("H", value);
      },
      onTransport: (transport) => {
        connections.push(model.connect("H", transport));
      },
    });
    h.change(true);
    h.observations[0].settle("obsolete");
    h.observations[1].settle("current");
    await Promise.all(connections);
    expect(applied).toEqual([{ app: { theme: "current" } }]);
    expect(model.getState().status).toBe("ready");
    h.change(true, false);
    await connections[2];
    expect(model.getState().status).toBe("unsupported");
    expect(h.observations).toHaveLength(2);
    expect(h.observations.every((observation) => observation.released)).toBe(true);
    stop();
  });

  it("keeps adopted authority when bootstrap hydration is requested again", async () => {
    const { model } = setup();
    await model.load();
    await model.selectHost("H");
    const h = host(snapshot("host"));
    await model.connect("H", h.transport);
    const before = model.getState();
    await model.load();
    expect(model.getState()).toBe(before);
    await model.receive("H", snapshot("host", 2));
    expect(model.getState()).toMatchObject({ status: "ready", canWrite: true });
    expect(h.writes).toEqual([]);
  });
  it("recovers local Retry after a failed host selection without discarding another host outbox", async () => {
    const first = setup();
    const remote = host(snapshot("host"));
    await first.model.load();
    await first.model.selectHost("A");
    await first.model.connect("A", remote.transport);
    await first.model.connect("A", null);
    await editTheme(first.model, "host", "pending");
    await first.model.selectHost(null);
    const saved = structuredClone(first.saved());
    let reads = 0;
    const model = new SettingsSyncModel({
      readLocal: async () => {
        reads++;
        return structuredClone(saved);
      },
      writeLocal: async () => {
        throw new Error("disk unavailable");
      },
      getDeviceValues: async () => ({}),
      applyValues: async () => {
        throw new Error("must not adopt settings");
      },
    });
    await model.load();
    await expect(model.selectHost("H")).rejects.toThrow("disk unavailable");
    expect(model.getState().status).toBe("error");
    await model.retry();
    expect(model.getState()).toMatchObject({
      selectedHost: null,
      status: "local",
      canWrite: true,
      error: null,
    });
    expect(reads).toBe(1);
    expect(first.saved()).toEqual(saved);
    expect(remote.writes).toEqual([]);
    expect(saved).toMatchObject({
      hosts: { A: { pending: [{ value: "pending" }], backup: { app: { theme: "device" } } } },
    });
  });

  it("retries storage after the first hydration fails", async () => {
    let reads = 0;
    const model = new SettingsSyncModel({
      readLocal: async () => {
        if (++reads === 1) throw new Error("unavailable");
        return null;
      },
      writeLocal: async () => {},
      getDeviceValues: async () => ({}),
      applyValues: async () => {},
    });
    await model.load();
    expect(model.getState().status).toBe("error");
    await model.retry();
    expect(reads).toBe(2);
    expect(model.getState()).toMatchObject({ status: "local", canWrite: true, error: null });
  });
});
