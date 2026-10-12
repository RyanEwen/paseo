import {
  openMobileAgentSidebar,
  closeMobileAgentSidebar,
  expectMobileAgentSidebarVisible,
} from "../support/helpers/sidebar";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createMockIdleAgent, openWorkspaceWithAgents } from "../support/helpers/archive-tab";
import { seedWorkspace } from "../support/helpers/seed-client";
import { test, expect } from "../support/fixtures";
import {
  buildHostWorkspaceRoute,
  buildOpenProjectRoute,
  buildSettingsHostSectionRoute,
  buildSettingsRoute,
  buildSettingsSectionRoute,
} from "@/utils/host-routes";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { getE2EDaemonPort } from "../support/helpers/daemon-port";
import {
  closeCompactSettings,
  openSettingsSection,
  expectSettingsHeader,
  openAddHostFlow,
  selectHostConnectionType,
  toggleHostAdvanced,
  openCompactSettings,
  expectCompactSettingsList,
  expectSettingsSidebarVisible,
  expectSettingsSidebarHidden,
  expectSettingsSidebarSections,
  goBackInSettings,
  expectSettingsBackButton,
  clickSettingsBackToWorkspace,
  verifyLegacyHostSettingsRedirect,
  openCompactSettingsHost,
  expectAddHostMethodOptions,
  fillDirectHostUri,
  expectDirectHostFormValues,
  expectDirectHostSslEnabled,
  expectDirectHostUriValue,
  expectDirectHostUriHidden,
  expectDiagnosticsContent,
  expectAboutContent,
  expectGeneralContent,
  expectAppearanceContent,
  seedSavedSettingsHosts,
  selectSettingsHost,
  expectSettingsHostPickerLabel,
  openSettingsHostSection,
  removeCurrentHostFromSettings,
} from "../support/helpers/settings";
import { getServerId } from "../support/helpers/server-id";
import { expectAppRoute } from "../support/helpers/route-assertions";

/** Fail only this fixture’s settings writes; restore before retrying the same control. */
async function failSettingsWrites(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "@paseo:app-settings") throw new Error("Owned fixture storage failure");
      original.call(this, key, value);
    };
    window.addEventListener(
      "fork-restore-storage",
      () => {
        Storage.prototype.setItem = original;
      },
      { once: true },
    );
  });
}

async function openWorkspace(
  page: import("@playwright/test").Page,
  workspace: { workspaceId: string },
) {
  await page.goto(buildHostWorkspaceRoute(getServerId(), workspace.workspaceId));
  await expect(page.getByTestId("menu-button")).toBeVisible();
}

test.describe("Settings sidebar navigation", () => {
  test("clicking a sidebar section updates the URL and renders the section", async ({ page }) => {
    await gotoAppShell(page);
    await openSettings(page);

    await openSettingsSection(page, "diagnostics");
    await expectSettingsHeader(page, "Diagnostics");
    await expectDiagnosticsContent(page);

    await openSettingsSection(page, "about");
    await expectSettingsHeader(page, "About");
    await expectAboutContent(page);

    await openSettingsSection(page, "general");
    await expectSettingsHeader(page, "General");
    await expectGeneralContent(page);

    await openSettingsSection(page, "appearance");
    await expectSettingsHeader(page, "Appearance");
    await expectAppearanceContent(page);

    await clickSettingsBackToWorkspace(page);
    await expect(page).not.toHaveURL(/\/settings(\/|$)/);
  });

  test("/h/[serverId]/settings redirects to the host connections section", async ({ page }) => {
    await gotoAppShell(page);
    await verifyLegacyHostSettingsRedirect(page);
  });

  test("direct connection advanced URI round-trips SSL and password into the form", async ({
    page,
  }) => {
    await gotoAppShell(page);
    await openSettings(page);
    await openAddHostFlow(page);
    await expectAddHostMethodOptions(page);
    await selectHostConnectionType(page, "direct");

    await toggleHostAdvanced(page);
    await fillDirectHostUri(page, "tcp://example.paseo.test:7443?ssl=true&password=shared-secret");
    await toggleHostAdvanced(page);

    await expectDirectHostFormValues(page, {
      host: "example.paseo.test",
      port: "7443",
      password: "shared-secret",
    });
    await expectDirectHostSslEnabled(page);
    await expectDirectHostUriHidden(page);

    await toggleHostAdvanced(page);
    await expectDirectHostUriValue(
      page,
      "tcp://example.paseo.test:7443?ssl=true&password=shared-secret",
    );
    await toggleHostAdvanced(page);
    await expectDirectHostUriHidden(page);
  });

  test("Escape lets settings dropdowns and modals close before leaving settings", async ({
    page,
  }) => {
    await gotoAppShell(page);
    await openSettings(page);

    await test.step("a dropdown owns Escape", async () => {
      await openSettingsSection(page, "appearance");
      await page.getByLabel(/Theme:/).click();
      await expect(page.getByRole("menuitem", { name: "System", exact: true })).toBeVisible();

      await page.keyboard.press("Escape");

      await expect(page.getByRole("menuitem", { name: "System", exact: true })).toHaveCount(0);
      await expect(page).toHaveURL(/\/settings(\/|$)/);
    });

    await test.step("a modal owns Escape", async () => {
      await openAddHostFlow(page);
      await expect(page.getByText("Add connection", { exact: true })).toBeVisible();

      await page.keyboard.press("Escape");

      await expect(page.getByText("Add connection", { exact: true })).toHaveCount(0);
      await expect(page).toHaveURL(/\/settings(\/|$)/);
    });

    await page.keyboard.press("Escape");
    await expect(page).not.toHaveURL(/\/settings(\/|$)/);
  });
});

test.describe("Settings — compact master-detail", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("opens compact app and host details and returns through the settings list", async ({
    page,
  }) => {
    await gotoAppShell(page);
    await openCompactSettings(page, buildOpenProjectRoute());

    await expectSettingsSidebarSections(page, ["general", "diagnostics", "about"]);
    await expectCompactSettingsList(page);

    await test.step("open app details and return to the list", async () => {
      await openSettingsSection(page, "diagnostics");
      await expectAppRoute(page, buildSettingsSectionRoute("diagnostics"));
      await expectDiagnosticsContent(page);
      await expectSettingsSidebarHidden(page);
      await expectSettingsBackButton(page);
      await goBackInSettings(page);
      await expectCompactSettingsList(page);
    });

    await test.step("open host details and return through the list", async () => {
      await openCompactSettingsHost(page);
      await expectSettingsBackButton(page);
      await expectSettingsSidebarHidden(page);
      await goBackInSettings(page);
      await expectAppRoute(page, buildSettingsRoute());
      await expectSettingsSidebarVisible(page);
      await expectSettingsBackButton(page);
      await goBackInSettings(page);
      await expect(page).not.toHaveURL(/\/settings(\/|$)/);
    });
  });

  test("host picker settings opens Overview and backs through the settings list", async ({
    page,
    withWorkspace,
  }) => {
    const workspace = await withWorkspace({ prefix: "host-picker-settings-back-" });
    const workspaceRoute = buildHostWorkspaceRoute(getServerId(), workspace.workspaceId);

    await openWorkspace(page, workspace);
    await page.getByRole("button", { name: "Open menu", exact: true }).click();
    await page.getByTestId("sidebar-hosts-trigger").click();
    await page.getByRole("button", { name: /Open .* settings/ }).click();

    await expectAppRoute(page, buildSettingsHostSectionRoute(getServerId(), "host"));
    await expect(page.getByText("Overview", { exact: true })).toBeVisible();

    await goBackInSettings(page);
    await expectCompactSettingsList(page);

    await goBackInSettings(page);
    await expectAppRoute(page, workspaceRoute);
  });

  test("switching the host picker on the settings list scopes host rows without navigating", async ({
    page,
  }) => {
    const primaryServerId = getServerId();
    const secondaryServerId = "srv_e2e_settings_secondary";
    const secondaryHostLabel = "Stable horse";
    const endpoint = `127.0.0.1:${getE2EDaemonPort()}`;

    await seedSavedSettingsHosts(page, [
      { serverId: primaryServerId, label: "First horse", endpoint },
      { serverId: secondaryServerId, label: secondaryHostLabel, endpoint },
    ]);
    await gotoAppShell(page);
    await openCompactSettings(page, buildOpenProjectRoute());

    await selectSettingsHost(page, secondaryServerId);

    await expectAppRoute(page, buildSettingsRoute());
    await expectSettingsSidebarVisible(page);
    await expectSettingsHostPickerLabel(page, secondaryHostLabel);

    await openSettingsHostSection(page, secondaryServerId, "connections");
  });

  test("removing the last active host returns to welcome after settings closes", async ({
    page,
    withWorkspace,
  }) => {
    const workspace = await withWorkspace({ prefix: "remove-host-compact-" });

    await openWorkspace(page, workspace);
    await openCompactSettings(page, buildHostWorkspaceRoute(getServerId(), workspace.workspaceId));
    await openSettingsHostSection(page, getServerId(), "host");
    await removeCurrentHostFromSettings(page);
    await closeCompactSettings(page);

    await expect(page).toHaveURL(/\/welcome$/);
    await expect(page.getByTestId("welcome-direct-connection")).toBeVisible();
  });
});

for (const width of [1440, 390]) {
  test(`Paseo++ inventory and reversible opt-outs at ${width}px`, async ({ page }) => {
    test.setTimeout(150_000);
    // The existing tab-seeding helper owns the desktop tab bar; resize after setup.
    await page.setViewportSize({ width: 1440, height: 900 });
    const workspace = await seedWorkspace({ repoPrefix: "fork-settings-" });
    const first = await createMockIdleAgent(workspace.client, {
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Settings proof first",
    });
    const second = await createMockIdleAgent(workspace.client, {
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Settings proof second",
    });
    try {
      await openWorkspaceWithAgents(page, [first, second]);
      await page.goto(buildSettingsRoute());
      await openSettingsSection(page, "paseo-plus-plus");
      const section = page.getByTestId("paseo-plus-plus-settings");
      const previous = section.getByRole("switch", { name: "Previous agents", exact: true });
      const sticky = section.getByRole("switch", {
        name: "Keep user prompts in view",
        exact: true,
      });
      const switches = section.getByTestId("paseo-plus-plus-features").getByRole("switch");
      await expect(switches).toHaveCount(8);
      for (let index = 0; index < 8; index += 1) {
        await expect(switches.nth(index)).toBeChecked();
      }
      const evidenceDir = resolve("../../docs/qa-evidence/paseo-plus-plus-settings");
      mkdirSync(evidenceDir, { recursive: true });
      // A fresh desktop checkpoint before changing width proves defaults independently of opt-outs.
      await page.screenshot({ path: resolve(evidenceDir, "settings-1440-fresh-all-on.png") });
      await page.setViewportSize({ width, height: 900 });
      await expect(section).toBeVisible();
      for (let index = 0; index < 8; index += 1) {
        await expect(switches.nth(index)).toBeChecked();
      }
      await page.screenshot({ path: resolve(evidenceDir, `settings-${width}-fresh-all-on.png`) });
      await previous.click();
      await sticky.click();
      await expect(previous).not.toBeChecked();
      await expect(sticky).not.toBeChecked();
      await page.reload();
      await expect(previous).not.toBeChecked();
      await expect(sticky).not.toBeChecked();
      await expect(section.getByText("Android SSH hosts", { exact: true })).toHaveCount(1);
      await expect(section.getByText("Branch and worktree choices", { exact: true })).toHaveCount(
        1,
      );
      await expect(
        section.getByRole("switch", { name: /SSH|worktree choices|Background browser/ }),
      ).toHaveCount(0);
      await page.screenshot({ path: resolve(evidenceDir, `settings-${width}-saved-off.png`) });
      await section
        .getByText("Independent fork installations", { exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({ path: resolve(evidenceDir, `settings-${width}-bottom.png`) });
      const autoOpen = section.getByRole("switch", {
        name: "Open sidebar for new workspaces",
        exact: true,
      });
      await expect(autoOpen).not.toBeChecked();
      const savedBeforeExplorer = await page.evaluate(() =>
        localStorage.getItem("@paseo:app-settings"),
      );
      await failSettingsWrites(page);
      await autoOpen.click();
      await expect(section.getByRole("alert")).toHaveText("Unable to save. Try again.");
      await expect(autoOpen).not.toBeChecked();
      expect(await page.evaluate(() => localStorage.getItem("@paseo:app-settings"))).toBe(
        savedBeforeExplorer,
      );
      await page.screenshot({
        path: resolve(evidenceDir, `settings-${width}-explorer-save-failed.png`),
      });
      await page.evaluate(() => window.dispatchEvent(new Event("fork-restore-storage")));
      await autoOpen.click();
      await expect(autoOpen).toBeChecked();
      await expect(section.getByRole("alert")).toHaveCount(0);
      await page.reload();
      await expect(autoOpen).toBeChecked();
      const diffScope = section.getByRole("button", {
        name: "Clicking a file in Changes: All changed files",
        exact: true,
      });
      const savedBeforeSelect = await page.evaluate(() =>
        localStorage.getItem("@paseo:app-settings"),
      );
      await failSettingsWrites(page);
      await diffScope.click();
      await page.getByRole("menuitem", { name: "Selected file only", exact: true }).click();
      await expect(section.getByRole("alert")).toHaveText("Unable to save. Try again.");
      await expect(diffScope).toBeVisible();
      expect(await page.evaluate(() => localStorage.getItem("@paseo:app-settings"))).toBe(
        savedBeforeSelect,
      );
      await page.evaluate(() => window.dispatchEvent(new Event("fork-restore-storage")));
      await diffScope.click();
      await page.getByRole("menuitem", { name: "Selected file only", exact: true }).click();
      await expect(section.getByRole("alert")).toHaveCount(0);
      await page.reload();
      await expect(
        section.getByRole("button", {
          name: "Clicking a file in Changes: Selected file only",
          exact: true,
        }),
      ).toBeVisible();
      await expect(section.getByTestId("paseo-plus-plus-link-updates")).toHaveCount(0);
      await expect(section.getByTestId("paseo-plus-plus-updates-info")).toContainText(
        "Desktop and supported Android builds",
      );
      await page.goto(buildSettingsSectionRoute("sidebar"));
      await expect(page.getByTestId("sidebar-nav-section-header")).toBeVisible();
      await expect(
        page.getByRole("switch", { name: "Open sidebar for new workspaces", exact: true }),
      ).toHaveCount(0);
      await expect(page.getByText("Default comparison", { exact: true })).toHaveCount(0);
      await page.goto(buildSettingsSectionRoute("paseo-plus-plus"));
      await expect(autoOpen).toBeChecked();
      await page.goto(buildHostWorkspaceRoute(getServerId(), workspace.workspaceId));
      const triggerId =
        width === 390 ? "workspace-header-menu-trigger" : "workspace-new-tab-button";
      const trigger = page.getByTestId(triggerId).filter({ visible: true }).first();
      await trigger.click();
      await expect(page.getByTestId("workspace-new-tab-menu-reopen-closed-agent")).toHaveCount(0);
      await page.keyboard.press("Escape");
      await page.goto(buildSettingsSectionRoute("paseo-plus-plus"));
      await expect(previous).not.toBeChecked();
      await failSettingsWrites(page);
      await previous.click();
      await expect(section.getByRole("alert")).toHaveText("Unable to save. Try again.");
      await expect(previous).not.toBeChecked();
      await page.evaluate(() => window.dispatchEvent(new Event("fork-restore-storage")));
      await previous.click();
      await expect(previous).toBeChecked();
      await expect(section.getByRole("alert")).toHaveCount(0);
      await expect(sticky).not.toBeChecked();
      await page.goto(buildHostWorkspaceRoute(getServerId(), workspace.workspaceId));
      await trigger.click();
      await expect(page.getByTestId("workspace-new-tab-menu-reopen-closed-agent")).toBeVisible();
      await page.screenshot({ path: resolve(evidenceDir, `settings-${width}-reenabled.png`) });
      await page.keyboard.press("Escape");
      await page.goto(buildSettingsSectionRoute("paseo-plus-plus"));
      const selectorSwitch = section.getByRole("switch", {
        name: "Project selector in sidebar",
        exact: true,
      });
      await expect(selectorSwitch).toBeChecked();
      await selectorSwitch.click();
      await expect(selectorSwitch).not.toBeChecked();
      await page.goto(buildHostWorkspaceRoute(getServerId(), workspace.workspaceId));
      if (width === 390) {
        await openMobileAgentSidebar(page);
        await expectMobileAgentSidebarVisible(page);
      }
      await expect(page.getByTestId("sidebar-project-selector")).toHaveCount(0);
      await expect(
        page.getByText("Workspaces", { exact: true }).filter({ visible: true }).first(),
      ).toBeVisible();
      await page.screenshot({ path: resolve(evidenceDir, `settings-${width}-selector-off.png`) });
      if (width === 390) await closeMobileAgentSidebar(page);
      await page.goto(buildSettingsSectionRoute("paseo-plus-plus"));
      await selectorSwitch.click();
      await expect(selectorSwitch).toBeChecked();
      await page.goto(buildHostWorkspaceRoute(getServerId(), workspace.workspaceId));
      if (width === 390) {
        await openMobileAgentSidebar(page);
        await expectMobileAgentSidebarVisible(page);
      }
      await expect(page.getByTestId("sidebar-project-selector")).toHaveText("All Workspaces");
      await page.screenshot({ path: resolve(evidenceDir, `settings-${width}-selector-on.png`) });
      if (width === 390) await closeMobileAgentSidebar(page);
      // Fail a genuine cold settings read, then recover through the page's shared Retry.
      await page.addInitScript(() => {
        if (sessionStorage.getItem("fork-settings-fail-read") !== "yes") return;
        const original = Storage.prototype.getItem;
        Storage.prototype.getItem = function (key) {
          if (key === "@paseo:app-settings") {
            const attempts = Number(
              original.call(sessionStorage, "fork-settings-read-attempts") ?? 0,
            );
            sessionStorage.setItem("fork-settings-read-attempts", String(attempts + 1));
            throw new Error("Owned fixture settings read failure");
          }
          return original.call(this, key);
        };
        window.addEventListener(
          "fork-restore-read",
          () => {
            Storage.prototype.getItem = original;
            sessionStorage.removeItem("fork-settings-fail-read");
          },
          { once: true },
        );
      });
      await page.evaluate(() => sessionStorage.setItem("fork-settings-fail-read", "yes"));
      await page.goto(buildSettingsSectionRoute("paseo-plus-plus"));
      await expect(section.getByRole("alert")).toContainText("Unable to load saved preferences", {
        timeout: 30_000,
      });
      for (let index = 0; index < 8; index += 1) await expect(switches.nth(index)).toBeDisabled();
      await expect(autoOpen).toBeDisabled();
      await expect(
        section.getByRole("switch", { name: "Automatically switch comparison", exact: true }),
      ).toBeDisabled();
      await expect(
        section.getByRole("button", { name: /^Clicking a file in Changes:/ }),
      ).toBeDisabled();
      await expect(section.getByRole("button", { name: /^Default comparison:/ })).toBeDisabled();
      const failedReadAttempts = await page.evaluate(() =>
        Number(sessionStorage.getItem("fork-settings-read-attempts")),
      );
      expect(failedReadAttempts).toBeGreaterThan(0);
      // Cover the first automatic remount-retry interval; the error UI must remain available.
      const settledAttempts = await page.evaluate(async () => {
        await new Promise((finishWindow) => setTimeout(finishWindow, 1_200));
        return Number(sessionStorage.getItem("fork-settings-read-attempts"));
      });
      expect(settledAttempts).toBe(failedReadAttempts);
      await expect(section.getByRole("alert")).toContainText("Unable to load saved preferences");
      await expect(autoOpen).toBeDisabled();
      await page.screenshot({ path: resolve(evidenceDir, `settings-${width}-read-failed.png`) });
      await page.evaluate(() => window.dispatchEvent(new Event("fork-restore-read")));
      await section.getByRole("button", { name: "Retry", exact: true }).click();
      await expect(section.getByRole("alert")).toHaveCount(0);
      await expect(autoOpen).toBeEnabled();
      await expect(autoOpen).toBeChecked();
      await expect(sticky).not.toBeChecked();
      await expect(previous).toBeChecked();
      await expect(
        section.getByRole("button", {
          name: "Clicking a file in Changes: Selected file only",
          exact: true,
        }),
      ).toBeEnabled();
    } finally {
      await workspace.cleanup();
    }
  });
}
