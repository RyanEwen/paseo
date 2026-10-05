import { createHash, generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect } from "@playwright/test";

const popupDocument =
  "<!doctype html><title>Extension UI fixture</title><h1>Native extension popup</h1>";

/** Seed inert, real unpacked extensions before the isolated Electron profile starts. */
export function seedBrowserExtensions(userData) {
  function fixture({ name, hasPopup, enabled, missing = false }) {
    // A manifest key gives the fixture a stable native identity independent of its folder.
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const key = publicKey.export({ type: "spki", format: "der" });
    const id = [...createHash("sha256").update(key).digest().subarray(0, 16)]
      .flatMap((byte) => [byte >> 4, byte & 15])
      .map((nibble) => String.fromCharCode(97 + nibble))
      .join("");
    const directory = path.join(userData, "extension-fixtures", id);
    const stagedDirectory = missing ? `${directory}-staged` : directory;
    fs.mkdirSync(stagedDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(stagedDirectory, "manifest.json"),
      JSON.stringify({
        manifest_version: 3,
        name,
        version: "1.0.0",
        key: key.toString("base64"),
        action: hasPopup ? { default_popup: "popup.html" } : {},
      }),
    );
    if (hasPopup) {
      fs.writeFileSync(path.join(stagedDirectory, "popup.html"), popupDocument);
    }
    return { id, name, version: "1.0.0", path: directory, source: "unpacked", enabled };
  }

  const popup = fixture({ name: "Popup UI fixture", hasPopup: true, enabled: true });
  const noPopup = fixture({ name: "No popup UI fixture", hasPopup: false, enabled: true });
  const missing = fixture({
    name: "Missing folder UI fixture",
    hasPopup: false,
    enabled: false,
    missing: true,
  });
  fs.writeFileSync(
    path.join(userData, "browser-extensions.json"),
    JSON.stringify([popup, noPopup, missing]),
  );
  return { popup, noPopup, missing, userData };
}

/** Exercise toolbar failure/retry and settings against native extension loading and persistence. */
export async function runBrowserExtensionsRegression({ page, fixtures, artifactDir, browserId }) {
  const { popup, noPopup, missing, userData } = fixtures;
  const trigger = page.getByRole("button", { name: "Extensions", exact: true });
  const action = (name) =>
    page.getByRole("menuitem").filter({ has: page.getByText(name, { exact: true }) });
  const section = page.getByTestId("browser-extensions");
  const row = (name) => section.getByText(name, { exact: true }).locator("..").locator("..");
  const catalog = () =>
    JSON.parse(fs.readFileSync(path.join(userData, "browser-extensions.json"), "utf8"));
  async function backToBrowser() {
    await page.locator('[data-testid="settings-back-to-workspace"]:visible').click();
    await expect(trigger).toBeVisible();
  }

  // Remove a real packaged resource, rather than rejecting a mocked bridge call.
  fs.unlinkSync(path.join(popup.path, "popup.html"));
  await trigger.click();
  await expect(action(noPopup.name)).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByText("No popup provided", { exact: true })).toBeVisible();
  await action(popup.name).click();
  const failure = page.getByText("Couldn't open extension", { exact: true });
  await expect(failure).toBeVisible();
  await expect(page.getByText(/ERR_FILE_NOT_FOUND/)).toBeVisible();
  // Closing/reopening the menu must not discard an unresolved actionable failure.
  await page.keyboard.press("Escape");
  await expect(failure).toBeHidden();
  await trigger.click();
  await expect(failure).toBeVisible();
  await expect(page.getByText(/ERR_FILE_NOT_FOUND/)).toBeVisible();
  const menuWidth = await failure.evaluate((element) => {
    let surface = element.parentElement;
    while (surface && !surface.querySelector('[role="menuitem"]')) {
      surface = surface.parentElement;
    }
    return surface?.getBoundingClientRect().width ?? 0;
  });
  const pane = await page.getByTestId(`browser-webview-clip-${browserId}`).boundingBox();
  expect(menuWidth).toBeGreaterThan(0);
  expect(menuWidth).toBeLessThan(pane.width);
  await page.screenshot({ path: path.join(artifactDir, "extension-popup-failure.png") });

  fs.writeFileSync(path.join(popup.path, "popup.html"), popupDocument);
  const nativePopupCreated = page.context().waitForEvent("page", {
    predicate: (candidate) => candidate !== page,
  });
  await action(popup.name).click();
  const nativePopup = await nativePopupCreated;
  await expect(nativePopup).toHaveURL(`chrome-extension://${popup.id}/popup.html`);
  await expect(nativePopup.getByRole("heading", { name: "Native extension popup" })).toBeVisible();
  expect(
    await nativePopup.evaluate(() => ({
      extensionId: chrome.runtime.id,
      node: typeof process,
      appBridge: typeof window.paseoDesktop,
    })),
  ).toEqual({ extensionId: popup.id, node: "undefined", appBridge: "undefined" });
  await nativePopup.close();
  await trigger.click();
  await expect(failure).toHaveCount(0);
  await action("Manage extensions").click();
  await expect(section).toBeVisible();

  await row(popup.name).getByRole("button", { name: "Disable", exact: true }).click();
  await expect(row(popup.name).getByRole("button", { name: "Enable", exact: true })).toBeVisible();
  expect(catalog().find((entry) => entry.id === popup.id).enabled).toBe(false);
  await backToBrowser();
  await trigger.click();
  await expect(action(popup.name)).toHaveCount(0);
  await action("Manage extensions").click();
  await row(popup.name).getByRole("button", { name: "Enable", exact: true }).click();
  await expect(row(popup.name).getByRole("button", { name: "Disable", exact: true })).toBeVisible();
  expect(catalog().find((entry) => entry.id === popup.id).enabled).toBe(true);

  await row(missing.name).getByRole("button", { name: "Enable", exact: true }).click();
  const settingsError = section.getByRole("alert");
  await expect(settingsError).toBeVisible();
  await expect(settingsError).toContainText(`Extension directory not found: ${missing.path}`);
  expect(catalog().find((entry) => entry.id === missing.id).enabled).toBe(false);
  await expect(
    row(missing.name).getByRole("button", { name: "Enable", exact: true }),
  ).toBeEnabled();
  await page.screenshot({ path: path.join(artifactDir, "extension-enable-failure.png") });
  fs.renameSync(`${missing.path}-staged`, missing.path);
  await row(missing.name).getByRole("button", { name: "Enable", exact: true }).click();
  await expect(
    row(missing.name).getByRole("button", { name: "Disable", exact: true }),
  ).toBeVisible();
  await expect(settingsError).toHaveCount(0);
  expect(catalog().find((entry) => entry.id === missing.id).enabled).toBe(true);
  await backToBrowser();
  await trigger.click();
  await expect(action(popup.name)).toBeEnabled();
  await expect(action(missing.name)).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");

  return { nativePopup: "passed", persistentFailureRetry: "passed", enabledCatalog: "passed" };
}
