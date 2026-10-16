import { createSettingsHostTransport } from "../../../../app/src/settings-sync/transport.js";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppSettingsSnapshot } from "@getpaseo/protocol/app-settings";
import { expect, test, vi } from "vitest";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";

test("real clients observe durable host preferences and detect conflicting writes", async () => {
  const daemon = await createTestPaseoDaemon({ mcpEnabled: false });
  const first = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws`, appVersion: "0.11.2" });
  const second = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.11.2",
  });
  try {
    await first.connect();
    await second.connect();
    expect(first.getLastServerInfoMessage()?.features?.appSettingsSync).toBe(true);
    const subscription = second.observeAppSettings();
    const initial = await subscription.ready;
    expect(initial.snapshot.initialized).toBe(false);
    const changes: unknown[] = [];
    const stop = subscription.subscribe({
      snapshot: () => {},
      update: (message) => {
        if (message.type === "app.settings.changed") changes.push(message.payload.snapshot);
      },
    });
    const seeded = await first.patchAppSettings(
      [{ path: ["app", "theme"], value: "dark", expectedRevision: 0 }],
      true,
    );
    expect(seeded.conflicts).toEqual([]);
    await expect.poll(() => changes.length).toBe(1);
    expect(changes[0]).toMatchObject({ initialized: true, values: { app: { theme: "dark" } } });
    const changed = await second.patchAppSettings([
      { path: ["app", "theme"], value: "light", expectedRevision: 1 },
    ]);
    expect(changed.conflicts).toEqual([]);
    const conflict = await first.patchAppSettings([
      { path: ["app", "theme"], value: "auto", expectedRevision: 1 },
    ]);
    expect(conflict.conflicts).toEqual([["app", "theme"]]);
    expect((await first.getAppSettings()).snapshot.values).toEqual({ app: { theme: "light" } });
    // Usage is hidden by default. Its visibility is the shared footer item preference.
    await first.patchAppSettings([
      {
        path: ["app", "sidebarFooterItems"],
        value: [{ key: "usage", visible: true }],
        expectedRevision: 0,
      },
    ]);
    const reloaded = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      appVersion: "0.11.2",
    });
    try {
      await reloaded.connect();
      expect((await reloaded.getAppSettings()).snapshot.values).toMatchObject({
        app: { sidebarFooterItems: [{ key: "usage", visible: true }] },
      });
    } finally {
      await reloaded.close();
    }
    await second.patchAppSettings([
      {
        path: ["app", "sidebarFooterItems"],
        value: [{ key: "usage", visible: false }],
        expectedRevision: 3,
      },
    ]);
    expect((await first.getAppSettings()).snapshot.values).toMatchObject({
      app: { sidebarFooterItems: [{ key: "usage", visible: false }] },
    });
    await expect.poll(() => changes.length).toBe(4);
    stop();
    await subscription.release();
    const count = changes.length;
    await first.patchAppSettings([{ path: ["app", "language"], value: "fr", expectedRevision: 0 }]);
    await first.getAppSettings();
    expect(changes).toHaveLength(count);
  } finally {
    await first.close();
    await second.close();
    await daemon.close();
  }
}, 60_000);

test("settings retry rebinds a failed bootstrap and resumes live changes after storage recovery", async () => {
  const daemon = await createTestPaseoDaemon({ mcpEnabled: false });
  const reader = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.11.2",
  });
  const writer = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.11.2",
  });
  const controller = new AbortController();
  // React Native provides abort state/events without the newer convenience method.
  Object.defineProperty(controller.signal, "throwIfAborted", { value: undefined });
  try {
    await reader.connect();
    await writer.connect();
    await writer.patchAppSettings(
      [{ path: ["app", "theme"], value: "dark", expectedRevision: 0 }],
      true,
    );
    const file = join(daemon.paseoHome, "app-settings.json");
    const original = await readFile(file, "utf8");
    await writeFile(file, "invalid JSON");
    const updates: AppSettingsSnapshot[] = [];
    const transport = createSettingsHostTransport({
      client: reader,
      signal: controller.signal,
      onSnapshot: (snapshot) => {
        updates.push(snapshot);
      },
    });
    await expect(transport.read()).rejects.toThrow();
    await writeFile(file, original);
    expect((await transport.read()).values).toEqual({ app: { theme: "dark" } });
    await writer.patchAppSettings([
      { path: ["app", "theme"], value: "light", expectedRevision: 1 },
    ]);
    await expect.poll(() => updates.at(-1)?.values).toEqual({ app: { theme: "light" } });
  } finally {
    controller.abort();
    await reader.close();
    await writer.close();
    await daemon.close();
  }
}, 60_000);

test("settings native cancellation without a reason stops before observing the host", async () => {
  const daemon = await createTestPaseoDaemon({ mcpEnabled: false });
  const reader = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.11.2",
  });
  const controller = new AbortController();
  // Match the native signal's available surface while retaining real abort events/state.
  Object.defineProperty(controller.signal, "throwIfAborted", { value: undefined });
  Object.defineProperty(controller.signal, "reason", { value: undefined });
  const observe = vi.spyOn(reader, "observeAppSettings");
  try {
    await reader.connect();
    controller.abort();
    const transport = createSettingsHostTransport({
      client: reader,
      signal: controller.signal,
      onSnapshot: () => {},
    });
    await expect(transport.read()).rejects.toMatchObject({
      name: "AbortError",
      message: "Settings read aborted",
    });
    expect(observe).not.toHaveBeenCalled();
    expect((await reader.getAppSettings()).snapshot.initialized).toBe(false);
  } finally {
    observe.mockRestore();
    await reader.close();
    await daemon.close();
  }
}, 60_000);

test("settings native cancellation after bootstrap preserves its reason and releases observation", async () => {
  const daemon = await createTestPaseoDaemon({ mcpEnabled: false });
  const reader = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.11.2",
  });
  const controller = new AbortController();
  Object.defineProperty(controller.signal, "throwIfAborted", { value: undefined });
  const reason = new Error("Settings host changed");
  const observations: ReturnType<DaemonClient["observeAppSettings"]>[] = [];
  const observeHost = reader.observeAppSettings.bind(reader);
  const observe = vi.spyOn(reader, "observeAppSettings").mockImplementation((options) => {
    const subscription = observeHost(options);
    observations.push(subscription);
    // Keep the real SDK/daemon; deterministically cancel between readiness and the caller's adoption.
    Object.defineProperty(subscription, "ready", {
      value: subscription.ready.then((snapshot) => {
        controller.abort(reason);
        return snapshot;
      }),
    });
    return subscription;
  });
  const updates: AppSettingsSnapshot[] = [];
  try {
    await reader.connect();
    const transport = createSettingsHostTransport({
      client: reader,
      signal: controller.signal,
      onSnapshot: (snapshot) => {
        updates.push(snapshot);
      },
    });
    await expect(transport.read()).rejects.toBe(reason);
    expect(observations).toHaveLength(1);
    const [subscription] = observations;
    expect(() => subscription.subscribe({ snapshot: () => {} })).toThrow("Subscription released");
    await reader.patchAppSettings(
      [{ path: ["app", "theme"], value: "dark", expectedRevision: 0 }],
      true,
    );
    await reader.getAppSettings();
    expect(updates).toEqual([]);
  } finally {
    observe.mockRestore();
    controller.abort();
    await reader.close();
    await daemon.close();
  }
}, 60_000);
