/** @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import { ToastApiProvider } from "@/contexts/toast-api-context";
import { ExtensionsMenu } from "./extensions-menu.electron";

void i18n;
const mocks = vi.hoisted(() => ({
  actions: vi.fn(),
  openPopup: vi.fn(),
  openStore: vi.fn(),
  push: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/desktop/host", () => ({ getDesktopHost: () => ({ browser: { extensions: mocks } }) }));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: mocks.push }) }));
const clients: QueryClient[] = [];
const toastApi = { show: vi.fn(), copied: vi.fn(), error: mocks.error };
const emptyStyle = {};
function triggerStyle() {
  return emptyStyle;
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.resetAllMocks();
  mocks.actions.mockResolvedValue([{ id: "a".repeat(32), name: "Fixture popup", hasPopup: true }]);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clients.splice(0).forEach((client) => client.clear());
});

function showMenu() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <ToastApiProvider api={toastApi}>
        <ExtensionsMenu
          browserId="browser-fixture"
          triggerStyle={triggerStyle}
          tooltipTextStyle={emptyStyle}
        />
      </ToastApiProvider>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Extensions" }));
}

test("toolbar popup targets the installed extension and current browser", async () => {
  showMenu();
  fireEvent.click(await screen.findByText("Fixture popup"));
  await waitFor(() =>
    expect(mocks.openPopup).toHaveBeenCalledWith("a".repeat(32), "browser-fixture"),
  );
});

test("background-only extensions explain that no popup is available", async () => {
  mocks.actions.mockResolvedValue([
    { id: "b".repeat(32), name: "Background only", hasPopup: false },
  ]);
  showMenu();
  const row = await screen.findByRole("menuitem", { name: /Background only/ });
  expect(row.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(row);
  expect(mocks.openPopup).not.toHaveBeenCalled();
  expect(screen.getByText("No popup provided")).toBeDefined();
});

test("a popup failure is reported through the visible toast API", async () => {
  mocks.openPopup.mockRejectedValueOnce(new Error("The browser tab is no longer available."));
  showMenu();
  fireEvent.click(await screen.findByText("Fixture popup"));
  await waitFor(() =>
    expect(mocks.error).toHaveBeenCalledWith(
      expect.stringContaining("The browser tab is no longer available."),
    ),
  );
});

test("management opens the Browser settings section", async () => {
  showMenu();
  fireEvent.click(await screen.findByText("Manage extensions"));
  expect(mocks.push).toHaveBeenCalledWith("/settings/browser");
});
