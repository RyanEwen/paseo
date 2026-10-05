/** @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import type { DesktopBrowserExtension } from "@/desktop/host";
import { BrowserExtensionsSection } from "./extensions-section";

void i18n;
const bridge = vi.hoisted(() => ({
  list: vi.fn(),
  setEnabled: vi.fn(),
  remove: vi.fn(),
  loadUnpacked: vi.fn(),
  openStore: vi.fn(),
}));
// Node cannot host Electron's context bridge; exercise the real settings UI against its IPC port.
vi.mock("@/desktop/host", () => ({ getDesktopHost: () => ({ browser: { extensions: bridge } }) }));
vi.mock("@/utils/confirm-dialog", () => ({ confirmDialog: async () => true }));

const clients: QueryClient[] = [];
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.resetAllMocks();
  bridge.list.mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clients.splice(0).forEach((client) => client.clear());
});

function showSettings() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <BrowserExtensionsSection />
    </QueryClientProvider>,
  );
}

test("Store and unpacked controls invoke the desktop extension bridge", async () => {
  showSettings();
  await screen.findByText("No extensions installed.");
  fireEvent.click(screen.getByRole("button", { name: "Open Web Store" }));
  await waitFor(() => expect(bridge.openStore).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Load unpacked" }).getAttribute("aria-disabled"),
    ).not.toBe("true"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Load unpacked" }));
  await waitFor(() => expect(bridge.loadUnpacked).toHaveBeenCalledOnce());
});

test("failed Store opens show the error and allow retry", async () => {
  bridge.openStore.mockRejectedValueOnce(new Error("Could not reach Chrome Web Store"));
  showSettings();
  fireEvent.click(screen.getByRole("button", { name: "Open Web Store" }));
  await screen.findByText("Could not reach Chrome Web Store");
  fireEvent.click(screen.getByRole("button", { name: "Open Web Store" }));
  await waitFor(() => expect(bridge.openStore).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByText("Could not reach Chrome Web Store")).toBeNull());
});

test("failed enable keeps the extension disabled and retry updates the row", async () => {
  const extension: DesktopBrowserExtension = {
    id: "a".repeat(32),
    name: "Fixture",
    version: "1.0",
    source: "store",
    enabled: false,
  };
  bridge.list.mockImplementation(async () => [{ ...extension }]);
  bridge.setEnabled.mockRejectedValueOnce(new Error("Extension folder is missing"));
  bridge.setEnabled.mockImplementationOnce(async () => {
    extension.enabled = true;
  });
  showSettings();
  fireEvent.click(await screen.findByRole("button", { name: "Enable" }));
  await screen.findByText("Extension folder is missing");
  expect(screen.getByRole("button", { name: "Enable" })).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Enable" }));
  await screen.findByRole("button", { name: "Disable" });
  expect(bridge.setEnabled).toHaveBeenLastCalledWith(extension.id, true);
});

test("failed removal retains its row with a visible error", async () => {
  bridge.list.mockResolvedValue([
    { id: "a".repeat(32), name: "Fixture", version: "1.0", source: "store", enabled: true },
  ]);
  bridge.remove.mockRejectedValueOnce(new Error("Could not remove extension files"));
  showSettings();
  fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
  await screen.findByText("Could not remove extension files");
  expect(screen.getByText("Fixture").textContent).toBe("Fixture");
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(bridge.remove).toHaveBeenCalledTimes(2));
});
