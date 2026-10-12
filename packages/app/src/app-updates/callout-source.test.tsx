/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PASEO_PLUS_PLUS_PREFERENCES } from "@/paseo-plus-plus/preferences";
import type { SidebarCalloutOptions } from "@/contexts/sidebar-callout-context";
import { AndroidUpdateCalloutSource } from "./callout-source";
import { useAndroidUpdate } from "./store";

interface SettingsHydration {
  loading: boolean;
  enabled: boolean;
  error: Error | null;
}

const hydration: SettingsHydration = { loading: true, enabled: true, error: null };

// Node has no Android lifecycle or installer. Exercise the real consumer and store,
// substituting settings hydration and those native/network boundaries.
const fakes = vi.hoisted(() => ({
  listeners: new Set<(state: string) => void>(),
  lifecycle: {
    currentState: "active",
    addEventListener: vi.fn(),
  },
  native: {
    getVersionCode: () => 1_000_000_013,
    download: vi.fn(),
    install: vi.fn(),
  },
  find: vi.fn(),
  resource: vi.fn(),
  show: vi.fn<(options: SidebarCalloutOptions) => () => void>(),
}));
const callouts = { show: fakes.show };
vi.mock("react-native", () => ({ AppState: fakes.lifecycle }));
vi.mock("./native", () => ({ androidUpdaterNative: fakes.native }));
vi.mock("@/hooks/use-settings", () => ({
  useAppSettings: () => ({
    settings: {
      paseoPlusPlus: {
        ...DEFAULT_PASEO_PLUS_PLUS_PREFERENCES,
        androidAutomaticUpdateChecks: hydration.enabled,
      },
    },
    isLoading: hydration.loading,
    error: hydration.error,
  }),
}));
vi.mock("@/contexts/sidebar-callout-context", () => ({ useSidebarCallouts: () => callouts }));
vi.mock("./releases", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./releases")>()),
  findAndroidUpdate: fakes.find,
  requestUpdateResource: fakes.resource,
}));

const update = {
  version: "0.11.1-preview.14",
  versionCode: 1_000_000_014,
  url: "https://github.com/RyanEwen/paseo/releases/download/v0.11.1-preview.14/paseo.apk",
  checksumUrl: "https://github.com/RyanEwen/paseo/releases/download/v0.11.1-preview.14/SHA256SUMS",
  filename: "paseo.apk",
};
let root: Root;
let container: HTMLDivElement;

/** Rerender the mounted consumer when settings hydration or its preference changes. */
async function render() {
  await act(async () => root.render(<AndroidUpdateCalloutSource />));
}

/** Deliver a lifecycle signal through the listener the consumer actually registered. */
async function resume() {
  await act(async () => {
    for (const listener of fakes.listeners) listener("active");
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  hydration.loading = true;
  hydration.enabled = true;
  hydration.error = null;
  fakes.lifecycle.currentState = "active";
  fakes.listeners.clear();
  fakes.lifecycle.addEventListener.mockImplementation((_, listener) => {
    fakes.listeners.add(listener);
    return { remove: () => fakes.listeners.delete(listener) };
  });
  fakes.find.mockResolvedValue(null);
  fakes.resource.mockResolvedValue(`${"a".repeat(64)}  paseo.apk`);
  fakes.native.download.mockResolvedValue(undefined);
  fakes.native.install.mockResolvedValue("installer_opened");
  fakes.show.mockReturnValue(() => {});
  useAndroidUpdate.setState({ status: "idle", update: null, error: null });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Android automatic-check preference", () => {
  it("waits for hydration and never leaks a startup request for a persisted opt-out", async () => {
    await render();
    await resume();
    await act(async () => vi.advanceTimersByTimeAsync(30 * 60 * 1000));
    expect(fakes.find).not.toHaveBeenCalled();
    expect(fakes.lifecycle.addEventListener).not.toHaveBeenCalled();
    hydration.loading = false;
    hydration.enabled = false;
    await render();
    await resume();
    await act(async () => vi.advanceTimersByTimeAsync(30 * 60 * 1000));
    expect(fakes.find).not.toHaveBeenCalled();
    expect(fakes.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps checks stopped when saved preferences could not be read", async () => {
    hydration.loading = false;
    hydration.error = new Error("Unable to read saved settings");
    await render();
    await resume();
    await act(async () => vi.advanceTimersByTimeAsync(30 * 60 * 1000));
    expect(fakes.find).not.toHaveBeenCalled();
    expect(fakes.listeners.size).toBe(0);
    hydration.error = null;
    await render();
    expect(fakes.find).toHaveBeenCalledTimes(1);
  });

  it("starts checks after hydration, then removes every trigger while disabled", async () => {
    await render();
    hydration.loading = false;
    await render();
    expect(fakes.find).toHaveBeenCalledTimes(1);
    await resume();
    expect(fakes.find).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(30 * 60 * 1000));
    expect(fakes.find).toHaveBeenCalledTimes(3);
    hydration.enabled = false;
    await render();
    await resume();
    await act(async () => vi.advanceTimersByTimeAsync(60 * 60 * 1000));
    expect(fakes.find).toHaveBeenCalledTimes(3);
    expect(fakes.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    hydration.enabled = true;
    await render();
    expect(fakes.find).toHaveBeenCalledTimes(4);
    expect(fakes.listeners.size).toBe(1);
  });

  it("does not cancel an already-started check or suppress its availability notice", async () => {
    let finish = () => {};
    fakes.find.mockReturnValue(
      new Promise<typeof update>((resolve) => {
        finish = () => resolve(update);
      }),
    );
    hydration.loading = false;
    await render();
    expect(useAndroidUpdate.getState().status).toBe("checking");
    hydration.enabled = false;
    await render();
    await act(async () => finish());
    expect(useAndroidUpdate.getState()).toMatchObject({ status: "available", update });
    expect(fakes.show.mock.lastCall?.[0]).toMatchObject({ id: "android-app-update" });
    expect(fakes.find).toHaveBeenCalledTimes(1);
  });

  it("leaves manual checks and the existing install action usable while opted out", async () => {
    hydration.enabled = false;
    hydration.loading = false;
    fakes.find.mockResolvedValue(update);
    await render();
    await act(async () => useAndroidUpdate.getState().check());
    expect(fakes.find).toHaveBeenCalledTimes(1);
    const notice = fakes.show.mock.lastCall?.[0];
    if (!notice?.actions?.[0]) throw new Error("The manual update notice has no install action");
    await act(async () => notice.actions?.[0].onPress());
    expect(fakes.native.download).toHaveBeenCalledWith(
      update.url,
      "a".repeat(64),
      update.versionCode,
    );
    expect(fakes.native.install).toHaveBeenCalledWith(update.versionCode);
    expect(useAndroidUpdate.getState().status).toBe("installer");
  });
});
