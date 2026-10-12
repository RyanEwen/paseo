import { expect, type Page } from "@playwright/test";
import { test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import {
  closeSidebarDisplayPreferences,
  openSidebarDisplayPage,
  openSidebarProjectFilter,
  pinWorkspaceFromSidebar,
  openMobileAgentSidebar,
  selectAllProjectsFilter,
  selectSidebarStatusGrouping,
  toggleProjectFilter,
} from "../support/helpers/sidebar";

/** Pick a display option through the same menu on desktop and compact layouts. */
async function selectDisplayOption(page: Page, section: string, option: string): Promise<void> {
  await openSidebarDisplayPage(page, `sidebar-display-${section}`);
  await page.getByTestId(option).click();
  await closeSidebarDisplayPreferences(page);
}

test.describe("Sidebar project filter", () => {
  test.describe.configure({ timeout: 180_000 });

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
    const projectRow = page.getByTestId(`sidebar-project-row-${workspace.projectKey}`);
    await row.hover();
    const workspaceHoverColor = await row.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    await page.mouse.move(0, 0);
    await expect(projectRow).toHaveCSS("background-color", workspaceHoverColor);
    await projectRow.hover();
    await expect(projectRow).not.toHaveCSS("background-color", workspaceHoverColor);
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
    await page.mouse.move(0, 0);
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
    await workspace.client.setWorkspacePinned(second.id, true);
    await expect(chip).toHaveText("2 working");
    await page.getByTestId("sidebar-collapse-all").click();
    await expect(chip).toHaveText("2 working");
    await page.screenshot({ path: testInfo.outputPath("sidebar-two-working.png") });
  } finally {
    await workspace.cleanup();
  }
});
