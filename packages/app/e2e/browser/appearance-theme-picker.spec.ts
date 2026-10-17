import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { openSettingsSection } from "../support/helpers/settings";

test("shows Pure black in the appearance picker", async ({ page }, testInfo) => {
  await page.goto("/settings");
  await expect(page.getByTestId("settings-sidebar")).toBeVisible();
  await openSettingsSection(page, "appearance");

  const themeTrigger = page.getByLabel("Theme: System", { exact: true });
  await themeTrigger.click();
  await expect(page.getByText("Pure black", { exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("appearance-theme-picker.png"),
    fullPage: true,
  });
});

test("keeps the selected workspace visible in Light", async ({ page }, testInfo) => {
  const workspace = await seedWorkspace({
    repoPrefix: "light-selected-workspace-",
    title: "Selected workspace",
  });

  try {
    await page.addInitScript(() => {
      localStorage.setItem("@paseo:app-settings", JSON.stringify({ theme: "light" }));
    });
    await gotoAppShell(page);

    const row = page.getByTestId(`sidebar-workspace-row-${getServerId()}:${workspace.workspaceId}`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();

    await expect(row).toHaveAttribute("aria-selected", "true");
    await expect(row).toHaveCSS("background-color", "rgb(212, 212, 216)");
    await page.screenshot({
      path: testInfo.outputPath("light-selected-workspace.png"),
      fullPage: true,
    });
  } finally {
    await workspace.cleanup();
  }
});

test("keeps the selected workspace visible in Pure black", async ({ page }, testInfo) => {
  const workspace = await seedWorkspace({
    repoPrefix: "pure-black-selected-workspace-",
    title: "Selected workspace",
  });

  try {
    await page.addInitScript(() => {
      localStorage.setItem("@paseo:app-settings", JSON.stringify({ theme: "pureBlack" }));
    });
    await gotoAppShell(page);

    const row = page.getByTestId(`sidebar-workspace-row-${getServerId()}:${workspace.workspaceId}`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();

    await expect(row).toHaveAttribute("aria-selected", "true");
    await expect(row).toHaveCSS("background-color", "rgb(17, 17, 17)");
    await page.screenshot({
      path: testInfo.outputPath("pure-black-selected-workspace.png"),
      fullPage: true,
    });
  } finally {
    await workspace.cleanup();
  }
});

test("applies the interface font size to settings text", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("@paseo:app-settings", JSON.stringify({ uiBaseFontSize: 21 }));
  });
  await page.goto("/settings");
  await expect(page.getByTestId("settings-sidebar")).toBeVisible();
  await openSettingsSection(page, "appearance");

  const sectionTitle = page.getByText("Theme", { exact: true }).first();
  await expect(sectionTitle).toHaveCSS("font-size", "18px");

  const interfaceSizeInput = page.getByLabel("Interface font size");
  const contentSizeInput = page.getByLabel("Content font size");
  await expect(interfaceSizeInput).toHaveValue("21");
  await expect(contentSizeInput).toHaveValue("21");
  await interfaceSizeInput.fill("12");
  await interfaceSizeInput.press("Tab");

  await expect(interfaceSizeInput).toHaveValue("12");
  await expect(contentSizeInput).toHaveValue("21");
  await expect(sectionTitle).toHaveCSS("font-size", "10px");
});

test("previews and retains accent colors independently of light and dark themes", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("accent-test-seeded")) {
      localStorage.setItem(
        "@paseo:app-settings",
        JSON.stringify({ theme: "light", accentColor: "default", contentMaxWidth: 1000 }),
      );
      localStorage.setItem("accent-test-seeded", "true");
    }
  });
  await page.goto("/settings");
  await openSettingsSection(page, "appearance");
  const preview = page.getByTestId("accent-message-preview");
  const bubble = preview.getByTestId("user-message-bubble");
  const text = preview.getByTestId("user-message-text");
  await expect(bubble).toHaveCSS("background-color", "rgb(228, 228, 231)");
  await page.getByLabel("Accent color: Default", { exact: true }).press("Enter");
  const blueOption = page.getByRole("menuitem", { name: "Blue", exact: true });
  await blueOption.focus();
  await blueOption.press("Enter");
  await expect(page.getByLabel("Accent color: Blue", { exact: true })).toBeEnabled();
  await expect(bubble).toHaveCSS("background-color", "rgb(29, 78, 216)");
  await expect(text).toHaveCSS("color", "rgb(255, 255, 255)");
  await page.reload();
  await openSettingsSection(page, "appearance");
  await expect(page.getByLabel("Accent color: Blue", { exact: true })).toBeVisible();
  await page.getByLabel("Accent color: Blue", { exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Blue", exact: true })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(page.getByRole("menuitem", { name: "Default", exact: true })).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await page.keyboard.press("Escape");
  await expect(bubble).toHaveCSS("background-color", "rgb(29, 78, 216)");
  await page.getByLabel("Theme: Light", { exact: true }).click();
  await page.getByText("Dark", { exact: true }).click();
  await expect(bubble).toHaveCSS("background-color", "rgb(147, 197, 253)");
  await expect(text).toHaveCSS("color", "rgb(24, 24, 27)");
  const reset = page.getByRole("button", { name: "Reset content width to default", exact: true });
  const resetText = reset.getByText("Reset", { exact: true });
  await page.mouse.move(2, 2);
  await expect(resetText).toHaveCSS("color", "rgb(161, 165, 164)");
  await reset.hover();
  await expect(resetText).toHaveCSS("color", "rgb(250, 250, 250)");
  await page.screenshot({ path: testInfo.outputPath("accent-blue-dark.png"), fullPage: true });
  await page.getByLabel("Accent color: Blue", { exact: true }).click();
  await page.getByText("Default", { exact: true }).click();
  await expect(page.getByLabel("Accent color: Default", { exact: true })).toBeEnabled();
  await expect(bubble).not.toHaveCSS("background-color", "rgb(147, 197, 253)");
});
