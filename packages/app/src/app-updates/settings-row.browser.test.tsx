import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { within } from "@testing-library/dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import { AndroidAppUpdateRow } from "./settings-row";
import { useAndroidUpdate } from "./store";
import type { AndroidUpdateDownloadProgress } from "./native-contract";

void i18n;
// Chromium renders the real update row and store; only Android and the release service are substituted.
const bridge = vi.hoisted(() => ({
  getVersionCode: () => 1_000_000_013,
  addListener: vi.fn(
    (_name: string, _handler: (progress: AndroidUpdateDownloadProgress) => void) => ({
      remove: vi.fn(),
    }),
  ),
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
let root: Root;
let container: HTMLDivElement;
let sequence = 14;
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  sequence += 1;
  bridge.download.mockReset().mockResolvedValue(undefined);
  bridge.install.mockReset().mockResolvedValue("installer_opened");
  requests.find.mockReset().mockResolvedValue({
    version: `0.11.1-preview.${sequence}`,
    versionCode: 1_000_000_000 + sequence,
    url: "https://example.test/update.apk",
    checksumUrl: "https://example.test/SHA256SUMS",
    filename: "paseo.apk",
  });
  requests.read.mockReset().mockResolvedValue(`${"a".repeat(64)}  paseo.apk`);
  useAndroidUpdate.setState({ status: "idle", update: null, error: null, progress: null });
  container = document.createElement("div");
  container.style.width = "360px";
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<AndroidAppUpdateRow />));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
async function click(label: string) {
  await act(async () => within(container).getByRole("button", { name: label }).click());
}

describe("Android update feedback", () => {
  it("shows byte progress and verification while preventing duplicate update actions", async () => {
    await click("Check");
    let finishDownload!: () => void;
    bridge.download.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishDownload = resolve;
        }),
    );

    // Keep the real store operation pending while native events update the rendered row.
    let installation!: Promise<void>;
    act(() => {
      installation = useAndroidUpdate.getState().install();
    });
    await vi.waitFor(() => expect(bridge.download).toHaveBeenCalledTimes(1));
    const listener = bridge.addListener.mock.calls.at(-1)?.[1];
    expect(listener).toBeTypeOf("function");
    const report = (
      totalBytes: number | null,
      phase: "downloading" | "verifying" = "downloading",
    ) => {
      act(() =>
        listener!({
          versionCode: 1_000_000_000 + sequence,
          bytesDownloaded: 1024 * 1024,
          totalBytes,
          phase,
        }),
      );
    };

    try {
      report(4 * 1024 * 1024);
      expect(within(container).getByText("Downloading 25% (1.0 MB / 4.0 MB)")).toBeTruthy();
      expect(
        within(container).getByRole("button", { name: "Check" }).getAttribute("aria-disabled"),
      ).toBe("true");
      expect(
        within(container)
          .getByRole("button", { name: "Install update" })
          .getAttribute("aria-disabled"),
      ).toBe("true");
      expect(bridge.install).not.toHaveBeenCalled();

      report(null);
      expect(within(container).getByText("Downloading 1.0 MB…")).toBeTruthy();
      report(1024 * 1024, "verifying");
      expect(within(container).getByText("Verifying the downloaded update…")).toBeTruthy();
      expect(container.scrollWidth).toBeLessThanOrEqual(container.clientWidth);
      expect(bridge.install).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        finishDownload();
        await installation;
      });
    }
    expect(within(container).getByText(/Finish installation in Android/)).toBeTruthy();
  });
  it("shows permission guidance, retains the install action, and acknowledges the installer handoff", async () => {
    await click("Check");
    expect(
      within(container).getByText(`Preview 0.11.1-preview.${sequence} is available.`).textContent,
    ).toBe(`Preview 0.11.1-preview.${sequence} is available.`);
    bridge.install.mockResolvedValueOnce("permission_required");
    await click("Install update");
    expect(
      within(container).getByText(/Allow updates from this app in Android Settings/).textContent,
    ).toContain("tap Install update again");
    expect(container.scrollWidth).toBeLessThanOrEqual(container.clientWidth);
    await click("Install update");
    expect(within(container).getByText(/Finish installation in Android/).textContent).toContain(
      "If you cancelled",
    );
    expect(bridge.download).toHaveBeenCalledTimes(1);
  });
  it("keeps a failed download visible and allows retry", async () => {
    await click("Check");
    bridge.download.mockRejectedValueOnce(new Error("Update checksum mismatch"));
    await click("Install update");
    expect(within(container).getByText("Update checksum mismatch").textContent).toBe(
      "Update checksum mismatch",
    );
    expect(bridge.install).not.toHaveBeenCalled();
    await click("Install update");
    expect(within(container).getByText(/Finish installation in Android/).textContent).toContain(
      "Finish installation",
    );
  });
  it("shows check failures and recovers to the current-version acknowledgement", async () => {
    requests.find.mockRejectedValueOnce(new Error("Offline"));
    await click("Check");
    expect(within(container).getByText("Offline").textContent).toBe("Offline");
    requests.find.mockResolvedValueOnce(null);
    await click("Check");
    expect(within(container).getByText("You have the latest published preview.").textContent).toBe(
      "You have the latest published preview.",
    );
  });
});
