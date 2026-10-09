import { beforeEach, describe, expect, it, vi } from "vitest";

// The native bridge is unavailable in Node. Isolate that boundary while exercising real store transitions.
const bridge = vi.hoisted(() => ({
  getVersionCode: () => 1_000_000_013,
  download: vi.fn(),
  install: vi.fn(),
}));
const requests = vi.hoisted(() => ({ find: vi.fn(), read: vi.fn() }));
vi.mock("./native", () => ({ androidUpdaterNative: bridge }));
vi.mock("./releases", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./releases")>()),
  findAndroidUpdate: requests.find,
  requestUpdateResource: requests.read,
}));

const update = {
  version: "0.11.1-preview.14",
  versionCode: 1_000_000_014,
  url: "https://github.com/RyanEwen/paseo/releases/download/v0.11.1-preview.14/paseo.apk",
  checksumUrl: "https://github.com/RyanEwen/paseo/releases/download/v0.11.1-preview.14/SHA256SUMS",
  filename: "paseo.apk",
};

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  requests.find.mockResolvedValue(update);
  requests.read.mockResolvedValue(`${"a".repeat(64)}  paseo.apk\n`);
  bridge.download.mockResolvedValue(undefined);
  bridge.install.mockResolvedValue("installer_opened");
});

describe("Android update operation", () => {
  it("retains a verified download across the permission prompt and cancelled installation", async () => {
    const { useAndroidUpdate: store } = await import("./store");
    await store.getState().check();
    bridge.install.mockResolvedValueOnce("permission_required");
    await store.getState().install();
    expect(store.getState().status).toBe("permission");
    await store.getState().check(true);
    expect(requests.find).toHaveBeenCalledTimes(1);
    await store.getState().install();
    expect(store.getState().status).toBe("installer");
    await store.getState().install();
    expect(bridge.download).toHaveBeenCalledTimes(1);
    expect(bridge.install).toHaveBeenCalledTimes(3);
    expect(bridge.download).toHaveBeenCalledWith(update.url, "a".repeat(64), update.versionCode);
  });
  it("keeps failed downloads actionable and downloads again on retry", async () => {
    const { useAndroidUpdate: store } = await import("./store");
    await store.getState().check();
    bridge.download.mockRejectedValueOnce(new Error("Update checksum mismatch"));
    await store.getState().install();
    expect(store.getState()).toMatchObject({
      status: "error",
      error: "Update checksum mismatch",
      update,
    });
    expect(bridge.install).not.toHaveBeenCalled();
    await store.getState().install();
    expect(store.getState()).toMatchObject({ status: "installer", error: null });
    expect(bridge.download).toHaveBeenCalledTimes(2);
  });
  it("never invokes the native installer with a malformed checksum", async () => {
    const { useAndroidUpdate: store } = await import("./store");
    await store.getState().check();
    requests.read.mockResolvedValue("bad  paseo.apk");
    await store.getState().install();
    expect(store.getState().status).toBe("error");
    expect(bridge.download).not.toHaveBeenCalled();
    expect(bridge.install).not.toHaveBeenCalled();
  });
  it("prevents overlapping downloads and checks", async () => {
    const { useAndroidUpdate: store } = await import("./store");
    await store.getState().check();
    let finish = () => {};
    bridge.download.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const pending = store.getState().install();
    await vi.waitFor(() => expect(bridge.download).toHaveBeenCalledTimes(1));
    await store.getState().install();
    await store.getState().check();
    expect(requests.find).toHaveBeenCalledTimes(1);
    finish();
    await pending;
    expect(bridge.install).toHaveBeenCalledTimes(1);
  });
  it("reports manual check errors and keeps background checks quiet", async () => {
    const { useAndroidUpdate: store } = await import("./store");
    await store.getState().check();
    requests.find.mockRejectedValue(new Error("Offline"));
    await store.getState().check(true);
    expect(store.getState()).toMatchObject({ status: "available", error: null, update });
    await store.getState().check();
    expect(store.getState()).toMatchObject({ status: "error", error: "Offline", update });
  });
  it("reports installer launch errors and permits a fresh retry", async () => {
    const { useAndroidUpdate: store } = await import("./store");
    await store.getState().check();
    bridge.install.mockRejectedValueOnce(new Error("Installer unavailable"));
    await store.getState().install();
    expect(store.getState()).toMatchObject({ status: "error", error: "Installer unavailable" });
    await store.getState().install();
    expect(store.getState().status).toBe("installer");
  });
});
