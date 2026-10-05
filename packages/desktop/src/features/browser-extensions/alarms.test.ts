import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExtensionAlarms } from "./alarms.js";

const id = "a".repeat(32);
const otherId = "b".repeat(32);
let directory: string;
let time: number;
let callback: (() => void) | undefined;
let delay: number | undefined;
let enabled: Set<string>;
let version: string;
const emit = vi.fn();
const onError = vi.fn();
const schedulers: Array<ReturnType<typeof createExtensionAlarms>> = [];

function scheduler(minimumDelayMs?: (id: string) => number) {
  const alarms = createExtensionAlarms({
    storagePath: path.join(directory, "alarms.json"),
    now: () => time,
    getExtension: (extensionId) => (enabled.has(extensionId) ? { version } : null),
    emit,
    onError,
    minimumDelayMs,
    setTimer(next, wait) {
      callback = next;
      delay = wait;
      return () => {
        if (callback === next) {
          callback = undefined;
          delay = undefined;
        }
      };
    },
  });
  schedulers.push(alarms);
  return alarms;
}

async function tick(alarms: ReturnType<typeof createExtensionAlarms>, nextTime: number) {
  time = nextTime;
  const pending = callback;
  callback = undefined;
  expect(pending).toBeTypeOf("function");
  pending?.();
  // A read joins the same queue after the timer, without depending on filesystem timing.
  await alarms.request(id, "alarms.getAll", []);
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "paseo-extension-alarms-"));
  time = 1_000_000;
  version = "1";
  callback = undefined;
  delay = undefined;
  enabled = new Set([id, otherId]);
  emit.mockClear();
  onError.mockClear();
});
afterEach(async () => {
  for (const alarms of schedulers.splice(0)) {
    alarms.dispose();
  }
  await rm(directory, { recursive: true, force: true });
});

describe("browser-owned extension alarms", () => {
  it("supports unnamed and object-name overloads, isolated replacement and snapshot reads", async () => {
    const alarms = scheduler();
    await alarms.loaded(id);
    await alarms.loaded(otherId);
    await alarms.request(id, "alarms.create", [undefined, { delayInMinutes: 1 }]);
    await alarms.request(id, "alarms.create", [{ name: "named", periodInMinutes: 2 }]);
    await alarms.request(otherId, "alarms.create", ["named", { delayInMinutes: 3 }]);
    await alarms.request(id, "alarms.create", ["named", { delayInMinutes: 4 }]);
    const result = await alarms.request(id, "alarms.get", ["named"]);
    expect(result).toEqual({
      name: "named",
      scheduledTime: time + 240_000,
      persistAcrossSessions: true,
    });
    if (typeof result === "object" && result !== null) {
      Object.assign(result, { scheduledTime: 0 });
    }
    expect(await alarms.request(id, "alarms.get", ["named"])).toHaveProperty(
      "scheduledTime",
      time + 240_000,
    );
    expect(await alarms.request(otherId, "alarms.get", ["named"])).toHaveProperty(
      "scheduledTime",
      time + 180_000,
    );
    expect(await alarms.request(id, "alarms.clear", [])).toBe(true);
    expect(await alarms.request(id, "alarms.clear", [])).toBe(false);
    expect(await alarms.request(id, "alarms.clearAll", [])).toBe(true);
    expect(await alarms.request(id, "alarms.clearAll", [])).toBe(true);
    expect(await alarms.request(otherId, "alarms.getAll", [])).toHaveLength(1);
  });

  it("validates finite timing, conflicting overloads and names before changing existing state", async () => {
    const alarms = scheduler();
    await alarms.loaded(id);
    const invalid = [
      [],
      [{}],
      [{ when: Infinity }],
      [{ delayInMinutes: NaN }],
      [{ when: time, delayInMinutes: 1 }],
      ["name", { name: "other", delayInMinutes: 1 }],
      ["é".repeat(513), { delayInMinutes: 1 }],
      [{ delayInMinutes: Number.MAX_VALUE }],
      [{ when: time + 60_000, periodInMinutes: Number.MAX_VALUE }],
    ];
    for (const args of invalid) {
      await expect(alarms.request(id, "alarms.create", args)).rejects.toThrow();
    }
    await expect(alarms.request(id, "alarms.get", [null])).rejects.toThrow();
    await expect(alarms.request(id, "alarms.clearAll", ["unexpected"])).rejects.toThrow();
    expect(await alarms.request(id, "alarms.getAll", [])).toEqual([]);
  });

  it("enforces the minimum without early events and coalesces missed repeat ticks from wake time", async () => {
    const alarms = scheduler();
    await alarms.loaded(id);
    await alarms.request(id, "alarms.create", ["repeat", { periodInMinutes: 0.01 }]);
    expect(delay).toBe(30_000);
    await tick(alarms, time + 10_000);
    expect(emit).not.toHaveBeenCalled();
    expect(delay).toBe(20_000);
    await tick(alarms, time + 190_000);
    expect(emit).toHaveBeenCalledExactlyOnceWith(id, "alarms.onAlarm", {
      name: "repeat",
      scheduledTime: 1_030_000,
      periodInMinutes: 0.01,
      persistAcrossSessions: true,
    });
    expect(await alarms.request(id, "alarms.get", ["repeat"])).toHaveProperty(
      "scheduledTime",
      time + 30_000,
    );
    expect(delay).toBe(30_000);
  });

  it("clamps finite short values and throttles separate alarms within one extension", async () => {
    const alarms = scheduler();
    await alarms.loaded(id);
    await alarms.request(id, "alarms.create", ["first", { delayInMinutes: -1 }]);
    await alarms.request(id, "alarms.create", ["second", { when: time + 31_000 }]);
    await tick(alarms, time + 30_000);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(delay).toBe(30_000);
    await tick(alarms, time + 1_000);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(delay).toBe(29_000);
    await tick(alarms, time + 29_000);
    expect(emit).toHaveBeenCalledTimes(2);
    await alarms.request(id, "alarms.create", ["zero", { periodInMinutes: 0 }]);
    expect(delay).toBe(30_000);
  });

  it("uses Chrome's one-second developer minimum for zero and negative repeat periods", async () => {
    const alarms = scheduler(() => 0);
    await alarms.loaded(id);
    await alarms.request(id, "alarms.create", ["zero", { periodInMinutes: 0 }]);
    await alarms.request(id, "alarms.create", ["negative", { periodInMinutes: -1 }]);
    expect(delay).toBe(1_000);
    await tick(alarms, time + 999);
    expect(emit).not.toHaveBeenCalled();
    expect(delay).toBe(1);
    await tick(alarms, time + 1);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(delay).toBe(1_000);
    const next = await alarms.request(id, "alarms.getAll", []);
    expect(next).toEqual([
      expect.objectContaining({ name: "zero", scheduledTime: time + 1_000, periodInMinutes: 0 }),
      expect.objectContaining({
        name: "negative",
        scheduledTime: time + 1_000,
        periodInMinutes: -1,
      }),
    ]);
    await tick(alarms, time + 1_000);
    expect(emit).toHaveBeenCalledTimes(4);
    expect(delay).toBe(1_000);
  });

  it("fires a one-shot only once and does not leave a timer keeping a worker active", async () => {
    const alarms = scheduler();
    await alarms.loaded(id);
    await alarms.request(id, "alarms.create", [{ when: time - 100 }]);
    await tick(alarms, time + 30_000);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(await alarms.request(id, "alarms.get", [])).toBeUndefined();
    expect(callback).toBeUndefined();
    expect(
      JSON.parse(await readFile(path.join(directory, "alarms.json"), "utf8")).alarms[id],
    ).toBeUndefined();
  });

  it("persists only cross-session alarms and suspends delivery across disable and reload", async () => {
    const alarms = scheduler();
    await alarms.loaded(id);
    await alarms.request(id, "alarms.create", ["persistent", { delayInMinutes: 1 }]);
    await alarms.request(id, "alarms.create", [
      "session",
      { delayInMinutes: 1, persistAcrossSessions: false },
    ]);
    expect(
      JSON.parse(await readFile(path.join(directory, "alarms.json"), "utf8")).alarms[id],
    ).toHaveLength(1);
    enabled.delete(id);
    await alarms.unloaded(id);
    expect(callback).toBeUndefined();
    time += 120_000;
    expect(emit).not.toHaveBeenCalled();
    enabled.add(id);
    await alarms.loaded(id);
    expect(await alarms.request(id, "alarms.get", ["session"])).toBeUndefined();
    expect(delay).toBe(0);
    alarms.dispose();
    const reopened = scheduler();
    expect(callback).toBeUndefined();
    await reopened.loaded(id);
    await tick(reopened, time);
    expect(emit).toHaveBeenCalledExactlyOnceWith(
      id,
      "alarms.onAlarm",
      expect.objectContaining({ name: "persistent" }),
    );
  });

  it("orders concurrent mutations and cancels a due delivery when disabled before dispatch", async () => {
    const alarms = scheduler();
    await alarms.loaded(id);
    await Promise.all([
      alarms.request(id, "alarms.create", ["same", { delayInMinutes: 1 }]),
      alarms.request(id, "alarms.create", ["same", { delayInMinutes: 2 }]),
      alarms.request(id, "alarms.clear", ["same"]),
    ]);
    expect(await alarms.request(id, "alarms.getAll", [])).toEqual([]);
    await alarms.request(id, "alarms.create", [{ delayInMinutes: 1 }]);
    time += 60_000;
    const pending = callback;
    callback = undefined;
    pending?.();
    enabled.delete(id);
    await alarms.unloaded(id);
    expect(emit).not.toHaveBeenCalled();
    expect(callback).toBeUndefined();
  });

  it("ignores unload after shutdown without changing the last persistent session state", async () => {
    const alarms = scheduler();
    await alarms.loaded(id);
    await alarms.request(id, "alarms.create", ["saved", { delayInMinutes: 1 }]);
    const saved = await readFile(path.join(directory, "alarms.json"), "utf8");
    const queued = alarms.unloaded(id);
    alarms.dispose();
    await expect(queued).resolves.toBeUndefined();
    await expect(alarms.unloaded(id)).resolves.toBeUndefined();
    expect(await readFile(path.join(directory, "alarms.json"), "utf8")).toBe(saved);
    expect(callback).toBeUndefined();
    expect(onError).not.toHaveBeenCalled();
  });

  it("clears even persistent alarms when the installed extension version changes", async () => {
    const alarms = scheduler();
    await alarms.loaded(id);
    await alarms.request(id, "alarms.create", ["old", { delayInMinutes: 1 }]);
    await alarms.unloaded(id);
    version = "2";
    await alarms.loaded(id);
    expect(await alarms.request(id, "alarms.getAll", [])).toEqual([]);
    expect(callback).toBeUndefined();
    expect(
      JSON.parse(await readFile(path.join(directory, "alarms.json"), "utf8")).versions[id],
    ).toBe("2");
  });

  it("removes installed state permanently on uninstall and caps long timer waits", async () => {
    const alarms = scheduler();
    await alarms.loaded(id);
    await alarms.request(id, "alarms.create", [{ when: time + 10_000_000_000 }]);
    expect(delay).toBe(2_147_483_647);
    await alarms.forgetExtension(id);
    expect(callback).toBeUndefined();
    expect(JSON.parse(await readFile(path.join(directory, "alarms.json"), "utf8"))).toEqual({
      alarms: {},
      versions: {},
    });
    await alarms.loaded(id);
    expect(await alarms.request(id, "alarms.getAll", [])).toEqual([]);
  });

  it("matches Chrome admission at 500 alarms, including replacement attempts", async () => {
    const saved = Array.from({ length: 500 }, (_, index) => ({
      name: String(index),
      scheduledTime: time + 60_000,
      persistAcrossSessions: true,
    }));
    await writeFile(
      path.join(directory, "alarms.json"),
      JSON.stringify({ alarms: { [id]: saved }, versions: { [id]: version } }),
    );
    const alarms = scheduler();
    await alarms.loaded(id);
    await expect(
      alarms.request(id, "alarms.create", ["new", { delayInMinutes: 1 }]),
    ).rejects.toThrow("500");
    await expect(alarms.request(id, "alarms.create", ["0", { delayInMinutes: 2 }])).rejects.toThrow(
      "500",
    );
    await alarms.request(id, "alarms.clear", ["1"]);
    await alarms.request(id, "alarms.create", ["new", { delayInMinutes: 2 }]);
    expect(await alarms.request(id, "alarms.getAll", [])).toHaveLength(500);
  });

  it("does not publish failed persistence and rejects corrupt restoration without overwriting it", async () => {
    const alarms = scheduler();
    await alarms.loaded(id);
    await writeFile(path.join(directory, "alarms.json.tmp"), "blocked");
    // A directory at the temporary destination forces a real filesystem write failure.
    await rm(path.join(directory, "alarms.json.tmp"));
    const { mkdir } = await import("node:fs/promises");
    await mkdir(path.join(directory, "alarms.json.tmp"));
    await expect(alarms.request(id, "alarms.create", [{ delayInMinutes: 1 }])).rejects.toThrow();
    expect(await alarms.request(id, "alarms.getAll", [])).toEqual([]);
    expect(callback).toBeUndefined();
    alarms.dispose();
    await writeFile(path.join(directory, "alarms.json"), "corrupt");
    const corrupted = scheduler();
    await expect(corrupted.loaded(id)).rejects.toThrow();
    expect(await readFile(path.join(directory, "alarms.json"), "utf8")).toBe("corrupt");
    expect(onError).toHaveBeenCalled();
  });
});
