import {
  seedStatusProject,
  startWorkingWorkspace,
  startNeedsInputWorkspace,
} from "../helpers/project-status-badge";
import { expect, type Page, type Locator } from "@playwright/test";
import { test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { waitForSidebarHydration } from "../support/helpers/workspace-ui";
import {
  closeSidebarDisplayPreferences,
  openSidebarDisplayPage,
  openSidebarProjectFilter,
  pinWorkspaceFromSidebar,
  openMobileAgentSidebar,
  expectMobileAgentSidebarVisible,
  selectAllProjectsFilter,
  selectSidebarStatusGrouping,
  toggleProjectFilter,
} from "../support/helpers/sidebar";

/** Read the durable allowlist, including keys for currently unavailable projects. */
async function readStoredProjectFilters(page: Page): Promise<string[]> {
  return page.evaluate(
    () => JSON.parse(localStorage.getItem("sidebar-view") ?? "{}").state.projectFilters,
  );
}

/** Pick a display option through the same menu on desktop and compact layouts. */
async function selectDisplayOption(page: Page, section: string, option: string): Promise<void> {
  await openSidebarDisplayPage(page, `sidebar-display-${section}`);
  await page.getByTestId(option).click();
  await closeSidebarDisplayPreferences(page);
}

/** Every activity state uses the trailing rail rather than the leading title rail. */
async function expectStatusOnRight(row: Locator, state: string): Promise<void> {
  const rowBounds = await row.boundingBox();
  const statusBounds = await row.getByTestId(`workspace-status-indicator-${state}`).boundingBox();
  if (!rowBounds || !statusBounds) throw new Error("Workspace status has no rendered bounds");
  expect(statusBounds.x).toBeGreaterThan(rowBounds.x + rowBounds.width / 2);
}

test.describe("Sidebar project filter", () => {
  test.describe.configure({ timeout: 180_000 });
  // This suite owns the legacy Display filter. The selector has its own coverage below.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const key = "@paseo:app-settings";
      const settings = JSON.parse(localStorage.getItem(key) ?? "{}");
      localStorage.setItem(
        key,
        JSON.stringify({
          ...settings,
          paseoPlusPlus: { ...settings.paseoPlusPlus, sidebarProjectSelector: false },
        }),
      );
    });
  });

  test("filters independently of grouping and keeps empty projects reachable in status mode", async ({
    page,
  }, testInfo) => {
    const occupied = await seedWorkspace({ repoPrefix: "display-occupied-", title: "Active work" });
    const empty = await seedWorkspace({ repoPrefix: "display-empty-", title: "Archived work" });
    const serverId = getServerId();
    const emptyProjectRow = page.getByTestId(`sidebar-project-row-${empty.projectKey}`);
    const occupiedRow = page.getByTestId(
      `sidebar-workspace-row-${serverId}:${occupied.workspaceId}`,
    );
    try {
      const archived = await empty.client.archiveWorkspace(empty.workspaceId);
      expect(archived.error).toBeNull();
      await gotoAppShell(page);
      await expect(occupiedRow).toBeVisible({ timeout: 30_000 });
      await expect(emptyProjectRow).toBeVisible();

      await expect(page.getByTestId("sidebar-empty-project-group")).toBeVisible();
      await selectDisplayOption(page, "grouping", "sidebar-grouping-empty-projects");
      await expect(page.getByTestId("sidebar-empty-project-group")).toHaveCount(0);
      await expect(emptyProjectRow).toBeVisible();
      await selectDisplayOption(page, "grouping", "sidebar-grouping-empty-projects");
      await expect(page.getByTestId("sidebar-empty-project-group")).toBeVisible();

      await selectDisplayOption(
        page,
        "project-visibility",
        "sidebar-project-visibility-unarchived",
      );
      await expect(emptyProjectRow).toHaveCount(0);
      await expect(occupiedRow).toBeVisible();
      await selectSidebarStatusGrouping(page);
      await expect(page.getByTestId("sidebar-empty-project-group")).toHaveCount(0);

      await selectDisplayOption(page, "project-visibility", "sidebar-project-visibility-all");
      await expect(page.getByTestId("sidebar-empty-project-group")).toBeVisible();
      await expect(emptyProjectRow).toBeVisible();
      await expect(occupiedRow).toBeVisible();
      await selectDisplayOption(page, "grouping", "sidebar-grouping-empty-projects");
      await expect(page.getByTestId("sidebar-empty-project-group")).toHaveCount(0);
      await expect(emptyProjectRow).toBeVisible();
      await page.reload();
      await expect(emptyProjectRow).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("sidebar-empty-project-group")).toHaveCount(0);
      await selectDisplayOption(page, "grouping", "sidebar-grouping-empty-projects");
      await expect(page.getByTestId("sidebar-empty-project-group")).toBeVisible();
      await page.getByTestId("sidebar-status-group-no-unarchived-workspaces").click();
      await expect(emptyProjectRow).toHaveCount(0);
      await page.getByTestId("sidebar-status-group-no-unarchived-workspaces").click();
      await expect(emptyProjectRow).toBeVisible();
      await selectDisplayOption(page, "grouping", "sidebar-grouping-project");
      await selectDisplayOption(page, "sorting", "sidebar-sorting-project");
      await page.reload();
      await expect(emptyProjectRow).toBeVisible({ timeout: 30_000 });
      await page.getByTestId("sidebar-display-preferences-menu").click();
      await expect(page.getByTestId("sidebar-display-grouping")).toContainText("Project");
      await expect(page.getByTestId("sidebar-display-sorting")).toContainText("Project name");
      await expect(page.getByTestId("sidebar-display-project-visibility")).toContainText(
        "All projects",
      );
      await page.screenshot({ path: testInfo.outputPath("sidebar-empty-project-group.png") });
      await closeSidebarDisplayPreferences(page);
    } finally {
      await empty.cleanup();
      await occupied.cleanup();
    }
  });

  test("pins the sidebar to one project across both grouping modes", async ({ page }) => {
    // Two temp repos means two projects, which is also what makes the `Project ›` row appear.
    const alpha = await seedWorkspace({ repoPrefix: "project-filter-alpha-", title: "Alpha work" });
    const beta = await seedWorkspace({ repoPrefix: "project-filter-beta-", title: "Beta work" });
    const serverId = getServerId();
    const alphaRow = page.getByTestId(`sidebar-workspace-row-${serverId}:${alpha.workspaceId}`);
    const betaRow = page.getByTestId(`sidebar-workspace-row-${serverId}:${beta.workspaceId}`);
    const filterTrigger = page.getByTestId("sidebar-display-project-filter");

    try {
      await gotoAppShell(page);
      await expect(alphaRow).toBeVisible({ timeout: 30_000 });
      await expect(betaRow).toBeVisible({ timeout: 30_000 });

      await openSidebarProjectFilter(page);
      await expect(page.getByTestId("sidebar-project-filter-all")).toBeVisible();
      await toggleProjectFilter(page, alpha.projectKey);
      await closeSidebarDisplayPreferences(page);

      await expect(alphaRow).toBeVisible();
      await expect(betaRow).toHaveCount(0, { timeout: 10_000 });

      // The indicator reads the filter as it is applied, so it must be on here.
      await page.getByTestId("sidebar-display-preferences-menu").click();
      await expect(filterTrigger).toBeVisible();
      await expect(filterTrigger.getByTestId("menu-sub-indicator")).toBeVisible();
      await closeSidebarDisplayPreferences(page);

      // Status grouping builds its rows from the workspace entries rather than the projects
      // array, so a filter applied in only one of the two places passes every check above and
      // silently fails right here.
      await selectSidebarStatusGrouping(page);
      await closeSidebarDisplayPreferences(page);
      await expect(alphaRow).toBeVisible({ timeout: 15_000 });
      await expect(betaRow).toHaveCount(0);

      // The filter is view state and survives a cold load.
      await page.reload();
      await expect(alphaRow).toBeVisible({ timeout: 30_000 });
      await expect(betaRow).toHaveCount(0);

      await openSidebarProjectFilter(page);
      await selectAllProjectsFilter(page);
      await closeSidebarDisplayPreferences(page);
      await expect(alphaRow).toBeVisible();
      await expect(betaRow).toBeVisible({ timeout: 15_000 });
    } finally {
      await beta.cleanup();
      await alpha.cleanup();
    }
  });

  test("keeps the display menu reachable when the pinned section swallows the filtered project", async ({
    page,
  }) => {
    // Pinning hoists a chat out of its project, and a project whose chats are ALL hoisted is
    // dropped from the project list entirely. Filter to that project and the list body has no
    // project rows left — so the header, which carries the only route back to the filter page,
    // has to survive on the strength of the filter alone.
    const alpha = await seedWorkspace({
      repoPrefix: "project-filter-pinned-",
      title: "Pinned work",
    });
    const beta = await seedWorkspace({ repoPrefix: "project-filter-other-", title: "Other work" });
    const serverId = getServerId();
    const alphaRow = page.getByTestId(`sidebar-workspace-row-${serverId}:${alpha.workspaceId}`);

    try {
      await gotoAppShell(page);
      await expect(alphaRow).toBeVisible({ timeout: 30_000 });

      await openSidebarProjectFilter(page);
      await toggleProjectFilter(page, alpha.projectKey);
      await closeSidebarDisplayPreferences(page);

      await pinWorkspaceFromSidebar(page, alpha.workspaceId);
      await expect(alphaRow).toBeVisible();

      // The way out of the filter is still on screen.
      await expect(page.getByTestId("sidebar-display-preferences-menu")).toBeVisible();
      await openSidebarProjectFilter(page);
      await selectAllProjectsFilter(page);
      await closeSidebarDisplayPreferences(page);
      await expect(
        page.getByTestId(`sidebar-workspace-row-${serverId}:${beta.workspaceId}`),
      ).toBeVisible({ timeout: 15_000 });
    } finally {
      await beta.cleanup();
      await alpha.cleanup();
    }
  });

  test("hides the filter row when there is only one project", async ({ page }) => {
    const only = await seedWorkspace({ repoPrefix: "project-filter-solo-", title: "Solo work" });
    const serverId = getServerId();

    try {
      await gotoAppShell(page);
      await expect(
        page.getByTestId(`sidebar-workspace-row-${serverId}:${only.workspaceId}`),
      ).toBeVisible({ timeout: 30_000 });

      await page.getByTestId("sidebar-display-preferences-menu").click();
      await expect(page.getByTestId("sidebar-display-preferences-content")).toBeVisible();
      await expect(page.getByTestId("sidebar-display-project-filter")).toHaveCount(0);
    } finally {
      await only.cleanup();
    }
  });
});

test("project chips stay visible through bulk collapse and reload", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const workspace = await seedWorkspace({
    repoPrefix: "sidebar-activity-",
    title: "Sidebar activity work",
  });
  const serverId = getServerId();
  const row = page.getByTestId(`sidebar-workspace-row-${serverId}:${workspace.workspaceId}`);
  const chip = page.getByTestId(`sidebar-project-status-${workspace.projectKey}`);
  try {
    await workspace.client.renameProject(
      workspace.projectId,
      "A long project name that should keep its activity and actions readable",
    );
    const agent = await workspace.client.createAgent({
      provider: "mock",
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Activity agent",
      model: "e2e-fast-stream",
      initialPrompt: "Finish this turn.",
    });
    await workspace.client.waitForFinish(agent.id, 20_000);
    await workspace.client.clearWorkspaceAttention(workspace.workspaceId);
    await gotoAppShell(page);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(chip).toHaveText("Done");
    await expectStatusOnRight(row, "done");
    const projectRow = page.getByTestId(`sidebar-project-row-${workspace.projectKey}`);
    await row.hover();
    const workspaceHoverColor = await row.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    await page.mouse.move(0, 0);
    await expect(projectRow).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await projectRow.hover();
    await expect(projectRow).toHaveCSS("background-color", workspaceHoverColor);
    await page.screenshot({ path: testInfo.outputPath("sidebar-project-hover.png") });
    await page.mouse.move(0, 0);

    await page.getByTestId("sidebar-collapse-all").click();
    await expect(row).toHaveCount(0);
    await expect(chip).toHaveText("Done");
    await page.reload();
    await expect(chip).toBeVisible({ timeout: 30_000 });
    await expect(row).toHaveCount(0);
    await page.getByTestId("sidebar-expand-all").click();
    await expect(row).toBeVisible();
    await expect(chip).toHaveText("Done");
    await row.hover();
    await page.getByTestId(`sidebar-workspace-kebab-${serverId}:${workspace.workspaceId}`).click();
    await page.getByRole("menuitem", { name: "Mark as unread", exact: true }).click();
    await expect(chip).toHaveText("Ready to review");
    await expectStatusOnRight(row, "attention");
    await page.mouse.move(0, 0);
    const projectBounds = await projectRow.boundingBox();
    if (!projectBounds) throw new Error("Project row has no rendered bounds");
    await expect
      .poll(async () => {
        const bounds = await chip.boundingBox();
        return bounds ? bounds.x + bounds.width : null;
      })
      .toBeCloseTo(projectBounds.x + projectBounds.width - 8, 0);
    const longNameChip = await chip.boundingBox();
    if (!longNameChip) throw new Error("Project chip has no rendered bounds");
    await workspace.client.renameProject(workspace.projectId, "Short");
    await expect(projectRow).toContainText("Short");
    await expect.poll(async () => (await chip.boundingBox())?.x).toBeCloseTo(longNameChip.x, 0);
    await workspace.client.renameProject(
      workspace.projectId,
      "A long project name that should keep its activity and actions readable",
    );
    await expect(projectRow).toContainText("A long project name");

    await workspace.client.setWorkspacePinned(workspace.workspaceId, true);
    await expect(page.getByTestId("sidebar-pinned-section")).toBeVisible();
    await expect(chip).toHaveText("Ready to review");
    await page.getByTestId("sidebar-collapse-all").click();
    await expect(row).toHaveCount(0);
    await expect(chip).toHaveText("Ready to review");
    await page.getByTestId("sidebar-expand-all").click();
    await expect(row).toBeVisible();
    await workspace.client.setWorkspacePinned(workspace.workspaceId, false);
    await expect(page.getByTestId("sidebar-pinned-section")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("sidebar-project-activity.png") });
    await selectSidebarStatusGrouping(page);
    await expect(row).toBeVisible();
    await page.getByTestId("sidebar-collapse-all").click();
    await expect(row).toHaveCount(0);
    await page.getByTestId("sidebar-expand-all").click();
    await expect(row).toBeVisible();
    await selectDisplayOption(page, "grouping", "sidebar-grouping-project");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "dark" });
    await openMobileAgentSidebar(page);
    await expectMobileAgentSidebarVisible(page);
    await expect(chip).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("sidebar-project-activity-compact-dark.png"),
    });
    await page.getByTestId("sidebar-display-preferences-menu").click();
    await expect(page.getByTestId("sidebar-collapse-all")).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath("sidebar-bulk-actions-compact-dark.png") });
    await page.getByTestId("sidebar-collapse-all").click();
    await expect(row).toHaveCount(0);
    await expect(chip).toHaveText("Ready to review");
    await page.getByTestId("sidebar-display-preferences-menu").click();
    await page.getByTestId("sidebar-expand-all").click();
    await expect(row).toBeVisible();
  } finally {
    await workspace.cleanup();
  }
});

test("project working count includes pinned workspaces", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const workspace = await seedWorkspace({
    repoPrefix: "sidebar-working-count-",
    title: "First worker",
  });
  try {
    const created = await workspace.client.createWorkspace({
      source: { kind: "worktree", cwd: workspace.repoPath, worktreeSlug: "second-worker" },
      title: "Second worker",
    });
    expect(created.error).toBeNull();
    if (!created.workspace) throw new Error("Second workspace was not created");
    const second = created.workspace;
    await gotoAppShell(page);
    const chip = page.getByTestId(`sidebar-project-status-${workspace.projectKey}`);
    await expect(chip).toHaveText("Done", { timeout: 30_000 });
    const firstAgent = await workspace.client.createAgent({
      provider: "mock",
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "First agent",
      model: "one-minute-stream",
      initialPrompt: "Stay busy",
    });
    await workspace.client.waitForAgentUpsert(
      firstAgent.id,
      (agent) => agent.status === "running",
      15_000,
    );
    await expect(chip).toHaveText("Working");
    const secondAgent = await workspace.client.createAgent({
      provider: "mock",
      cwd: second.workspaceDirectory,
      workspaceId: second.id,
      title: "Second agent",
      model: "one-minute-stream",
      initialPrompt: "Stay busy",
    });
    await workspace.client.waitForAgentUpsert(
      secondAgent.id,
      (agent) => agent.status === "running",
      15_000,
    );
    await expect(chip).toHaveText("2 working");
    await expect(
      chip.getByTestId(`sidebar-project-working-spinner-${workspace.projectKey}`),
    ).toBeVisible();
    const projectRow = page.getByTestId(`sidebar-project-row-${workspace.projectKey}`);
    await expect(projectRow.getByTestId("project-status-indicator-running")).toHaveCount(0);
    await page.mouse.move(0, 0);
    const restingBounds = await chip.boundingBox();
    if (!restingBounds) throw new Error("Working chip has no rendered bounds");
    const motionSamples = chip.evaluate(
      (element) =>
        new Promise<number[]>((resolve) => {
          const positions: number[] = [];
          const startedAt = performance.now();
          function sample() {
            positions.push(element.getBoundingClientRect().x);
            if (performance.now() - startedAt < 600) requestAnimationFrame(sample);
            else resolve(positions);
          }
          requestAnimationFrame(sample);
        }),
    );
    await projectRow.hover();
    await expect
      .poll(async () => (await chip.boundingBox())?.x ?? Infinity)
      .toBeLessThan(restingBounds.x - 20);
    await expect(
      page.getByTestId(`sidebar-project-new-worktree-${workspace.projectKey}`),
    ).toBeVisible();
    const hoveredBounds = await chip.boundingBox();
    if (!hoveredBounds) throw new Error("Hovered working chip has no rendered bounds");
    const positions = await motionSamples;
    expect(positions.some((x) => x < restingBounds.x - 2 && x > hoveredBounds.x + 2)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("sidebar-working-chip-hovered.png") });
    await page.mouse.move(0, 0);
    await expect.poll(async () => (await chip.boundingBox())?.x).toBeCloseTo(restingBounds.x, 0);

    const workspaceRow = page.getByTestId(
      `sidebar-workspace-row-${getServerId()}:${workspace.workspaceId}`,
    );
    const workspaceSpinner = workspaceRow.getByTestId("workspace-status-indicator-running");
    await page.mouse.move(0, 0);
    const rowBounds = await workspaceRow.boundingBox();
    const spinnerBounds = await workspaceSpinner.boundingBox();
    if (!rowBounds || !spinnerBounds)
      throw new Error("Working workspace row has no rendered bounds");
    expect(spinnerBounds.x).toBeGreaterThan(rowBounds.x + rowBounds.width / 2);
    await workspaceRow.hover();
    await expect
      .poll(async () => (await workspaceSpinner.boundingBox())?.x ?? Infinity)
      .toBeLessThan(spinnerBounds.x - 10);
    await expect(
      page.getByTestId(`sidebar-workspace-kebab-${getServerId()}:${workspace.workspaceId}`),
    ).toBeVisible();
    await page.mouse.move(0, 0);
    await expect
      .poll(async () => (await workspaceSpinner.boundingBox())?.x)
      .toBeCloseTo(spinnerBounds.x, 0);
    await workspace.client.setWorkspacePinned(second.id, true);
    await expect(chip).toHaveText("2 working");
    await page.getByTestId("sidebar-collapse-all").click();
    await expect(chip).toHaveText("2 working");
    await page.mouse.move(0, 0);
    await expect
      .poll(async () => {
        const bounds = await chip.boundingBox();
        return bounds ? bounds.x + bounds.width : null;
      })
      .toBeCloseTo(restingBounds.x + restingBounds.width, 0);
    await page.screenshot({ path: testInfo.outputPath("sidebar-two-working.png") });
    await page.getByTestId("sidebar-expand-all").click();
    const pinnedRow = page.getByTestId(`sidebar-workspace-row-${getServerId()}:${second.id}`);
    await expect(pinnedRow.getByTestId("workspace-status-indicator-running")).toBeVisible();
    await selectSidebarStatusGrouping(page);
    await expect(workspaceSpinner).toBeVisible();
    const statusSpinnerBounds = await workspaceSpinner.boundingBox();
    if (!statusSpinnerBounds) throw new Error("Status-group working spinner has no bounds");
    await workspaceRow.hover();
    await expect
      .poll(async () => (await workspaceSpinner.boundingBox())?.x ?? Infinity)
      .toBeLessThan(statusSpinnerBounds.x - 10);
    await page
      .getByTestId(`sidebar-workspace-kebab-${getServerId()}:${workspace.workspaceId}`)
      .click();
    await page.mouse.move(0, 0);
    await expect(page.getByRole("menuitem", { name: "Archive", exact: true })).toBeVisible();
    await expect(workspaceSpinner).toBeVisible();
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 390, height: 844 });
    await openMobileAgentSidebar(page);
    await expectMobileAgentSidebarVisible(page);
    await expect(workspaceSpinner).toBeVisible();
    await expect(
      page.getByTestId(`sidebar-workspace-kebab-${getServerId()}:${workspace.workspaceId}`),
    ).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("sidebar-working-workspaces-compact.png") });
  } finally {
    await workspace.cleanup();
  }
});

test.describe("Sidebar project selector", () => {
  test.describe.configure({ timeout: 180_000 });

  for (const compact of [false, true]) {
    test(`preserves multi-selection and filters pinned workspaces on ${compact ? "compact" : "desktop"}`, async ({
      page,
    }, testInfo) => {
      const alpha = await seedWorkspace({ repoPrefix: "selector-alpha-", title: "Alpha work" });
      const beta = await seedWorkspace({ repoPrefix: "selector-beta-", title: "Beta work" });
      const serverId = getServerId();
      const alphaRow = page.getByTestId(`sidebar-workspace-row-${serverId}:${alpha.workspaceId}`);
      const betaRow = page.getByTestId(`sidebar-workspace-row-${serverId}:${beta.workspaceId}`);
      const trigger = page.getByTestId("sidebar-project-selector");
      const surface = page.getByTestId(
        compact ? "sidebar-project-selector-content-content" : "sidebar-project-selector-content",
      );
      try {
        if (compact) await page.setViewportSize({ width: 390, height: 844 });
        await gotoAppShell(page);
        if (compact) await openMobileAgentSidebar(page);
        await expect(trigger).toHaveText("All Workspaces");
        await pinWorkspaceFromSidebar(page, beta.workspaceId);
        await trigger.click();
        await page.getByTestId(`sidebar-project-selector-${alpha.projectKey}-checkbox`).click();
        await expect(surface).toBeVisible();
        await expect(alphaRow).toBeVisible();
        await expect(betaRow).toHaveCount(0);
        await expect(trigger).toContainText("Workspaces");
        // The catalog stays complete after selecting one project.
        await expect(page.getByTestId(`sidebar-project-selector-${beta.projectKey}`)).toBeVisible();
        await page.getByTestId(`sidebar-project-selector-${beta.projectKey}-checkbox`).click();
        await expect(trigger).toHaveText("2 Projects’ Workspaces");
        await expect(betaRow).toBeVisible();
        if (compact) {
          await page
            .getByRole("button", { name: "Bottom sheet backdrop" })
            .first()
            .click({ position: { x: 12, y: 12 } });
        } else {
          await page.keyboard.press("Escape");
          await expect(trigger).toBeFocused();
        }
        await expect(surface).toHaveCount(0);
        await page.reload();
        if (compact) await openMobileAgentSidebar(page);
        await expect(trigger).toHaveText("2 Projects’ Workspaces");
        await page.getByTestId("sidebar-display-preferences-menu").click();
        await expect(page.getByTestId("sidebar-display-project-filter")).toHaveCount(0);
        await expect(page.getByTestId("sidebar-display-show")).toBeVisible();
        if (compact) {
          await page
            .getByRole("button", { name: "Bottom sheet backdrop" })
            .first()
            .click({ position: { x: 12, y: 12 } });
        } else {
          await closeSidebarDisplayPreferences(page);
        }
        await selectSidebarStatusGrouping(page);
        await expect(alphaRow).toBeVisible();
        await expect(betaRow).toBeVisible();
        await trigger.click();
        await page.getByTestId(`sidebar-project-selector-${beta.projectKey}-checkbox`).click();
        await expect(betaRow).toHaveCount(0);
        await page.getByTestId("sidebar-project-selector-all").click();
        await expect(trigger).toHaveText("All Workspaces");
        await expect(betaRow).toBeVisible();
        await expect(surface).toHaveCount(0);
        await trigger.click();
        await page.screenshot({
          path: testInfo.outputPath(`selector-${compact ? "compact" : "desktop"}.png`),
        });
      } finally {
        await beta.cleanup();
        await alpha.cleanup();
      }
    });
  }

  for (const compact of [false, true]) {
    test(`project names select only and close, checkboxes stay independent on ${compact ? "compact" : "desktop"}`, async ({
      page,
    }, testInfo) => {
      const alpha = await seedWorkspace({
        repoPrefix: "selector-single-alpha-",
        title: "Alpha work",
      });
      const beta = await seedWorkspace({ repoPrefix: "selector-single-beta-", title: "Beta work" });
      const trigger = page.getByTestId("sidebar-project-selector");
      const surface = page.getByTestId(
        compact ? "sidebar-project-selector-content-content" : "sidebar-project-selector-content",
      );
      const alphaName = page.getByTestId(`sidebar-project-selector-${alpha.projectKey}`);
      const betaName = page.getByTestId(`sidebar-project-selector-${beta.projectKey}`);
      const alphaCheckbox = page.getByTestId(
        `sidebar-project-selector-${alpha.projectKey}-checkbox`,
      );
      const betaCheckbox = page.getByTestId(`sidebar-project-selector-${beta.projectKey}-checkbox`);
      try {
        if (compact) await page.setViewportSize({ width: 390, height: 844 });
        await gotoAppShell(page);
        if (compact) await openMobileAgentSidebar(page);
        await trigger.click();
        await expect(alphaCheckbox).toHaveRole("checkbox");
        await expect(alphaCheckbox).toHaveAccessibleName(/Include selector-single-alpha-/);
        await expect(alphaName).toHaveAccessibleName(/Show only selector-single-alpha-/);
        await alphaCheckbox.click();
        await betaCheckbox.click();
        await expect(surface).toBeVisible();
        await expect(trigger).toHaveText("2 Projects’ Workspaces");
        await expect
          .poll(() => readStoredProjectFilters(page))
          .toEqual([alpha.projectKey, beta.projectKey]);
        await betaName.click();
        await expect(surface).toHaveCount(0, { timeout: 2000 });
        await expect.poll(() => readStoredProjectFilters(page)).toEqual([beta.projectKey]);
        if (!compact) await expect(trigger).toBeFocused();
        await trigger.click();
        await expect(betaCheckbox).toBeChecked();
        await expect(alphaCheckbox).not.toBeChecked();
        await alphaCheckbox.click();
        await expect(surface).toBeVisible();
        await expect
          .poll(() => readStoredProjectFilters(page))
          .toEqual([beta.projectKey, alpha.projectKey]);
        await page.screenshot({
          path: testInfo.outputPath(`split-selection-${compact ? "compact" : "desktop"}.png`),
        });
        await alphaName.click();
        await expect(surface).toHaveCount(0, { timeout: 2000 });
        await expect.poll(() => readStoredProjectFilters(page)).toEqual([alpha.projectKey]);
        await trigger.click();
        await page.getByTestId("sidebar-project-selector-all").click();
        await expect(surface).toHaveCount(0, { timeout: 2000 });
        await expect(trigger).toHaveText("All Workspaces");
        await expect.poll(() => readStoredProjectFilters(page)).toEqual([]);
      } finally {
        await beta.cleanup();
        await alpha.cleanup();
      }
    });
  }

  test("keyboard distinguishes choosing a name from toggling its checkbox", async ({
    page,
  }, testInfo) => {
    const alpha = await seedWorkspace({ repoPrefix: "selector-keyboard-alpha-" });
    const trigger = page.getByTestId("sidebar-project-selector");
    const surface = page.getByTestId("sidebar-project-selector-content");
    const name = page.getByTestId(`sidebar-project-selector-${alpha.projectKey}`);
    const checkbox = page.getByTestId(`sidebar-project-selector-${alpha.projectKey}-checkbox`);
    try {
      await gotoAppShell(page);
      await trigger.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("sidebar-project-selector-all")).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(name).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(surface).toHaveCount(0, { timeout: 2000 });
      await expect(trigger).toBeFocused();
      await expect.poll(() => readStoredProjectFilters(page)).toEqual([alpha.projectKey]);
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("sidebar-project-selector-all")).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowDown");
      await expect(checkbox).toBeFocused();
      await page.screenshot({ path: testInfo.outputPath("split-checkbox-keyboard-focus.png") });
      await page.keyboard.press("Space");
      await expect(checkbox).not.toBeChecked();
      await expect(checkbox).toBeFocused();
      await expect(surface).toBeVisible();
      await expect.poll(() => readStoredProjectFilters(page)).toEqual([]);
      await page.keyboard.press("Enter");
      await expect(checkbox).toBeChecked();
      await expect(surface).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
    } finally {
      await alpha.cleanup();
    }
  });

  test("keeps saved multi-project and offline keys through the feature opt-out", async ({
    page,
  }) => {
    const alpha = await seedWorkspace({ repoPrefix: "selector-saved-alpha-" });
    const beta = await seedWorkspace({ repoPrefix: "selector-saved-beta-" });
    const savedFilters = [alpha.projectKey, beta.projectKey, "offline-project"];
    try {
      await page.addInitScript((projectFilters) => {
        if (!localStorage.getItem("sidebar-view")) {
          localStorage.setItem(
            "sidebar-view",
            JSON.stringify({ version: 11, state: { projectFilters } }),
          );
        }
      }, savedFilters);
      await gotoAppShell(page);
      const trigger = page.getByTestId("sidebar-project-selector");
      await expect(trigger).toHaveText("2 Projects’ Workspaces");
      await trigger.click();
      await page.getByTestId(`sidebar-project-selector-${alpha.projectKey}-checkbox`).click();
      await expect(page.getByTestId("sidebar-project-selector-content")).toBeVisible();
      await expect
        .poll(() => readStoredProjectFilters(page))
        .toEqual([beta.projectKey, "offline-project"]);
      await page.getByTestId(`sidebar-project-selector-${alpha.projectKey}-checkbox`).click();
      await page.keyboard.press("Escape");
      const toggledFilters = [beta.projectKey, "offline-project", alpha.projectKey];
      await expect.poll(() => readStoredProjectFilters(page)).toEqual(toggledFilters);
      await page.evaluate(() => {
        const key = "@paseo:app-settings";
        const settings = JSON.parse(localStorage.getItem(key) ?? "{}");
        localStorage.setItem(
          key,
          JSON.stringify({
            ...settings,
            paseoPlusPlus: { ...settings.paseoPlusPlus, sidebarProjectSelector: false },
          }),
        );
      });
      await page.reload();
      await expect(trigger).toHaveCount(0);
      await openSidebarProjectFilter(page);
      await expect(page.getByTestId(`sidebar-project-filter-${alpha.projectKey}`)).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await expect(page.getByTestId(`sidebar-project-filter-${beta.projectKey}`)).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await closeSidebarDisplayPreferences(page);
      await expect.poll(() => readStoredProjectFilters(page)).toEqual(toggledFilters);
    } finally {
      await beta.cleanup();
      await alpha.cleanup();
    }
  });
});

test.describe("Sidebar project selector activity", () => {
  test.describe.configure({ timeout: 180_000 });

  for (const compact of [false, true]) {
    test(`live badges include unselected projects and respect the activity opt-out on ${compact ? "compact" : "desktop"}`, async ({
      page,
    }, testInfo) => {
      const busy = await seedStatusProject();
      const quiet = await seedWorkspace({ repoPrefix: "selector-quiet-", title: "Quiet work" });
      const trigger = page.getByTestId("sidebar-project-selector");
      const surface = page.getByTestId(
        compact ? "sidebar-project-selector-content-content" : "sidebar-project-selector-content",
      );
      const busyChoice = page.getByTestId(`sidebar-project-selector-${busy.seed.projectKey}`);
      const quietChoice = page.getByTestId(`sidebar-project-selector-${quiet.projectKey}`);
      const busyChip = page.getByTestId(
        `sidebar-project-selector-${busy.seed.projectKey}-activity`,
      );
      const quietChip = page.getByTestId(`sidebar-project-selector-${quiet.projectKey}-activity`);
      try {
        if (compact) await page.setViewportSize({ width: 390, height: 844 });
        await gotoAppShell(page);
        if (compact) await openMobileAgentSidebar(page);
        await waitForSidebarHydration(page);
        await pinWorkspaceFromSidebar(page, busy.seed.workspaceId);
        await trigger.click();
        await expect(busyChip).toHaveText("Done");
        await expect(quietChip).toHaveText("Done");
        await expect(
          page.getByTestId("sidebar-project-selector-all").getByRole("status"),
        ).toHaveCount(0);
        await startWorkingWorkspace(busy);
        await expect(busyChip).toHaveText("Working");
        await busy.seed.client.createAgent({
          provider: "mock",
          cwd: busy.seed.repoPath,
          workspaceId: busy.needsInputWorkspaceId,
          title: "Second worker",
          modeId: "load-test",
          model: "thirty-minute-stream",
          initialPrompt: "keep streaming for the test",
        });
        await expect(busyChip).toHaveText("2 working");
        await expect(page.getByTestId(`sidebar-project-status-${busy.seed.projectKey}`)).toHaveText(
          "2 working",
        );
        // A different selected project must not remove the busy choice's activity subscription.
        await quietChoice.click();
        await expect(surface).toHaveCount(0);
        await trigger.click();
        await expect(busyChip).toHaveText("2 working");
        await page.getByTestId(`sidebar-project-selector-${busy.seed.projectKey}-checkbox`).click();
        await expect(surface).toBeVisible();
        await expect(busyChip).toHaveText("2 working");
        await page.screenshot({
          path: testInfo.outputPath(
            `selector-activity-working-${compact ? "compact" : "desktop"}.png`,
          ),
        });
        await page.getByTestId(`sidebar-project-selector-${busy.seed.projectKey}-checkbox`).click();
        await expect.poll(() => readStoredProjectFilters(page)).toEqual([quiet.projectKey]);
        // This live priority change happens while the busy project's sidebar rows are filtered out.
        const approval = await busy.seed.client.createWorkspace({
          source: { kind: "directory", path: busy.seed.repoPath, projectId: busy.seed.projectId },
          title: "Approval work",
        });
        if (!approval.workspace) throw new Error(approval.error ?? "Approval workspace missing");
        await startNeedsInputWorkspace({ ...busy, needsInputWorkspaceId: approval.workspace.id });
        await expect(busyChip).toHaveText("Needs input");
        await expect(quietChip).toHaveText("Done");
        await expect(
          page.getByTestId(`sidebar-project-selector-${busy.seed.projectKey}-working-spinner`),
        ).toHaveCount(0);
        await page.screenshot({
          path: testInfo.outputPath(
            `selector-activity-input-${compact ? "compact" : "desktop"}.png`,
          ),
        });
        if (compact) {
          await page
            .getByRole("button", { name: "Bottom sheet backdrop" })
            .first()
            .click({ position: { x: 12, y: 12 } });
        } else {
          await page.keyboard.press("Escape");
        }
        await page.evaluate(() => {
          const key = "@paseo:app-settings";
          const settings = JSON.parse(localStorage.getItem(key) ?? "{}");
          localStorage.setItem(
            key,
            JSON.stringify({
              ...settings,
              paseoPlusPlus: { ...settings.paseoPlusPlus, sidebarActivityChips: false },
            }),
          );
        });
        await page.reload();
        if (compact) await openMobileAgentSidebar(page);
        await trigger.click();
        await expect(busyChip).toHaveCount(0);
        await expect(quietChip).toHaveCount(0);
        await expect(
          page.getByTestId(`sidebar-project-status-${busy.seed.projectKey}`),
        ).toHaveCount(0);
        await busyChoice.click();
        await expect(surface).toHaveCount(0);
        await expect.poll(() => readStoredProjectFilters(page)).toEqual([busy.seed.projectKey]);
        await expect(
          page.getByTestId(`sidebar-project-status-${busy.seed.projectKey}`),
        ).toHaveCount(0);
        await trigger.click();
        await page.getByTestId(`sidebar-project-selector-${quiet.projectKey}-checkbox`).click();
        await expect(surface).toBeVisible();
        await expect
          .poll(() => readStoredProjectFilters(page))
          .toEqual([busy.seed.projectKey, quiet.projectKey]);
        await expect(busyChip).toHaveCount(0);
      } finally {
        await quiet.cleanup();
        await busy.seed.cleanup();
      }
    });
  }
});
