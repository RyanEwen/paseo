import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { projectEquivalenceViewKey } from "../support/helpers/project-view-key";
import { seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import {
  seedSidebarMotionPreferences,
  startSidebarMotionProbe,
  stopSidebarMotionProbe,
  expectSidebarMotionPaused,
  resumeSidebarMotion,
} from "../support/helpers/sidebar-motion";
import { getServerId } from "../support/helpers/server-id";
import { seedWorkspace } from "../support/helpers/seed-client";
import {
  openSidebarDisplayPage,
  openMobileAgentSidebar,
  closeMobileAgentSidebar,
  expectMobileAgentSidebarHidden,
  selectSidebarStatusGrouping,
  selectSidebarProjectGrouping,
  closeSidebarDisplayPreferences,
} from "../support/helpers/sidebar";
import { waitForSidebarHydration } from "../support/helpers/workspace-ui";

async function rowTestIds(rows: Locator) {
  return rows.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-testid")),
  );
}

async function visibleBoundingBox(row: Locator) {
  const box = await row.boundingBox();
  if (!box) throw new Error("Expected a visible draggable row");
  return box;
}

async function pressProjectRow(rows: Locator) {
  await rows.page().mouse.down();
}

async function pressWorkspaceRow(rows: Locator) {
  const row = rows.nth(0);
  const hoveredBackground = await row.evaluate((node) => getComputedStyle(node).backgroundColor);
  await rows.page().mouse.down();
  await expect
    .poll(() => row.evaluate((node) => getComputedStyle(node).backgroundColor))
    .not.toBe(hoveredBackground);
}

async function quickDragFirstRowAfterSecond(
  rows: Locator,
  pressRow: (rows: Locator) => Promise<void>,
) {
  await expect(rows).toHaveCount(2);
  const before = await rowTestIds(rows);
  const sourceBox = await visibleBoundingBox(rows.nth(0));
  const targetBox = await visibleBoundingBox(rows.nth(1));

  const page = rows.page();
  const source = { x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height / 2 };
  const target = { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 };

  await page.mouse.move(source.x, source.y);
  await pressRow(rows);
  await page.mouse.move(source.x, source.y + 7);
  await expect
    .poll(() => rows.nth(0).evaluate((node) => getComputedStyle(node).borderTopWidth))
    .toBe("1px");
  await page.mouse.move(target.x, target.y, { steps: 4 });
  await page.mouse.up();

  await expect.poll(() => rowTestIds(rows)).toEqual([before[1], before[0]]);
}

/** Attempt the same physical gesture while sorting owns order; disabled rows have no drag feedback. */
async function expectSortedDragBlocked(rows: Locator) {
  await expect(rows).toHaveCount(2);
  const before = await rowTestIds(rows);
  const source = await visibleBoundingBox(rows.nth(0));
  const target = await visibleBoundingBox(rows.nth(1));
  const page = rows.page();
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => rowTestIds(rows)).toEqual(before);
}

test("projects, workspaces, and pinned chats reorder with an immediate mouse drag", async ({
  page,
}) => {
  const firstProject = await seedWorkspace({ repoPrefix: "sidebar-reorder-first-" });
  const secondProject = await seedWorkspace({ repoPrefix: "sidebar-reorder-second-" });

  try {
    const secondWorkspace = await firstProject.client.createWorkspace({
      source: {
        kind: "directory",
        path: firstProject.repoPath,
        projectId: firstProject.projectId,
      },
      title: "Second workspace",
    });
    if (!secondWorkspace.workspace) {
      throw new Error(secondWorkspace.error ?? "Failed to seed a second workspace");
    }

    await gotoAppShell(page);
    await waitForSidebarHydration(page);

    const firstProjectTestId = `sidebar-project-row-${projectEquivalenceViewKey(firstProject.projectKey)}`;
    const secondProjectTestId = `sidebar-project-row-${projectEquivalenceViewKey(secondProject.projectKey)}`;
    await quickDragFirstRowAfterSecond(
      page.locator(`[data-testid="${firstProjectTestId}"], [data-testid="${secondProjectTestId}"]`),
      pressProjectRow,
    );
    const firstWorkspaceTestId = `sidebar-workspace-row-${getServerId()}:${firstProject.workspaceId}`;
    const secondWorkspaceTestId = `sidebar-workspace-row-${getServerId()}:${secondWorkspace.workspace.id}`;
    await quickDragFirstRowAfterSecond(
      page.locator(
        `[data-testid="${firstWorkspaceTestId}"], [data-testid="${secondWorkspaceTestId}"]`,
      ),
      pressWorkspaceRow,
    );

    await openSidebarDisplayPage(page, "sidebar-display-workspace-sorting");
    await page.getByTestId("sidebar-workspace-sorting-name").click();
    await firstProject.client.setWorkspacePinned(firstProject.workspaceId, true);
    await secondProject.client.setWorkspacePinned(secondProject.workspaceId, true);
    const secondProjectWorkspaceTestId = `sidebar-workspace-row-${getServerId()}:${secondProject.workspaceId}`;
    await quickDragFirstRowAfterSecond(
      page.locator(
        `[data-testid="${firstWorkspaceTestId}"], [data-testid="${secondProjectWorkspaceTestId}"]`,
      ),
      pressWorkspaceRow,
    );
  } finally {
    await firstProject.cleanup();
    await secondProject.cleanup();
  }
});

test("project sorting restores custom drag order and is hidden in status grouping", async ({
  page,
}, testInfo) => {
  const zeta = await seedWorkspace({ repoPrefix: "sidebar-sort-zeta-", title: "Zeta work" });
  const alpha = await seedWorkspace({ repoPrefix: "sidebar-sort-alpha-", title: "Alpha work" });
  const alphaId = `sidebar-project-row-${projectEquivalenceViewKey(alpha.projectKey)}`;
  const zetaId = `sidebar-project-row-${projectEquivalenceViewKey(zeta.projectKey)}`;
  try {
    await zeta.client.renameProject(zeta.projectId, "Zeta");
    await alpha.client.renameProject(alpha.projectId, "Alpha");
    await gotoAppShell(page);
    await waitForSidebarHydration(page);
    const rows = page.locator(`[data-testid="${alphaId}"], [data-testid="${zetaId}"]`);
    await expect(rows).toHaveCount(2);
    await openSidebarDisplayPage(page, "sidebar-display-sorting");
    await page.getByTestId("sidebar-sorting-project").click();
    await expect.poll(() => rowTestIds(rows)).toEqual([alphaId, zetaId]);
    await expectSortedDragBlocked(rows);
    await page.getByTestId("sidebar-display-preferences-menu").click();
    await expect(page.getByTestId("sidebar-display-sorting")).toContainText("Project name");
    await closeSidebarDisplayPreferences(page);
    await openSidebarDisplayPage(page, "sidebar-display-sorting");
    await page.getByTestId("sidebar-sorting-custom").click();
    if ((await rowTestIds(rows))[0] !== alphaId)
      await quickDragFirstRowAfterSecond(rows, pressProjectRow);
    await expect.poll(() => rowTestIds(rows)).toEqual([alphaId, zetaId]);
    await quickDragFirstRowAfterSecond(rows, pressProjectRow);
    await page.getByTestId("sidebar-display-preferences-menu").click();
    await expect(page.getByTestId("sidebar-display-sorting")).toContainText("Custom order");
    await closeSidebarDisplayPreferences(page);
    await openSidebarDisplayPage(page, "sidebar-display-sorting");
    await page.getByTestId("sidebar-sorting-project").click();
    await expect.poll(() => rowTestIds(rows)).toEqual([alphaId, zetaId]);
    await openSidebarDisplayPage(page, "sidebar-display-sorting");
    await page.getByTestId("sidebar-sorting-custom").click();
    await expect.poll(() => rowTestIds(rows)).toEqual([zetaId, alphaId]);
    await selectSidebarStatusGrouping(page);
    await page.getByTestId("sidebar-display-preferences-menu").click();
    await expect(page.getByTestId("sidebar-display-sorting")).toHaveCount(0);
    await closeSidebarDisplayPreferences(page);
    await selectSidebarProjectGrouping(page);
    await page.reload();
    await expect.poll(() => rowTestIds(rows)).toEqual([zetaId, alphaId]);
    await page.getByTestId("sidebar-display-preferences-menu").click();
    await expect(page.getByTestId("sidebar-display-sorting")).toContainText("Custom order");
    await page.screenshot({ path: testInfo.outputPath("sidebar-display-preferences.png") });
  } finally {
    await alpha.cleanup();
    await zeta.cleanup();
  }
});

test("empty-project sorting is contextual and restores custom drag order in status grouping", async ({
  page,
}) => {
  const zeta = await seedWorkspace({ repoPrefix: "empty-sort-zeta-" });
  const alpha = await seedWorkspace({ repoPrefix: "empty-sort-alpha-" });
  const occupied = await seedWorkspace({ repoPrefix: "empty-sort-occupied-" });
  const alphaId = `sidebar-project-row-${projectEquivalenceViewKey(alpha.projectKey)}`;
  const zetaId = `sidebar-project-row-${projectEquivalenceViewKey(zeta.projectKey)}`;
  try {
    await zeta.client.renameProject(zeta.projectId, "Zeta");
    await alpha.client.renameProject(alpha.projectId, "Alpha");
    await zeta.client.archiveWorkspace(zeta.workspaceId);
    await alpha.client.archiveWorkspace(alpha.workspaceId);
    await gotoAppShell(page);
    await waitForSidebarHydration(page);
    await selectSidebarStatusGrouping(page);
    await openSidebarDisplayPage(page, "sidebar-display-empty-workspaces");
    await page.getByTestId("sidebar-empty-workspaces-group").click();
    const rows = page.locator(`[data-testid="${alphaId}"], [data-testid="${zetaId}"]`);
    await expect(rows).toHaveCount(2);
    const statusRows = page
      .getByTestId("sidebar-status-group-rows-done")
      .locator('[data-testid^="sidebar-workspace-row-"]');
    const initialWorkspaceOrder = await rowTestIds(statusRows);
    await openSidebarDisplayPage(page, "sidebar-display-empty-project-sorting");
    await expect(page.getByTestId("sidebar-empty-project-sorting-status")).toHaveCount(0);
    await page.getByTestId("sidebar-empty-project-sorting-project").click();
    await expect.poll(() => rowTestIds(rows)).toEqual([alphaId, zetaId]);
    await expectSortedDragBlocked(rows);
    await page.getByTestId("sidebar-display-preferences-menu").click();
    await expect(page.getByTestId("sidebar-display-empty-project-sorting")).toContainText(
      "Project name",
    );
    await closeSidebarDisplayPreferences(page);
    await openSidebarDisplayPage(page, "sidebar-display-empty-project-sorting");
    await page.getByTestId("sidebar-empty-project-sorting-custom").click();
    if ((await rowTestIds(rows))[0] !== alphaId)
      await quickDragFirstRowAfterSecond(rows, pressProjectRow);
    await expect.poll(() => rowTestIds(rows)).toEqual([alphaId, zetaId]);
    await quickDragFirstRowAfterSecond(rows, pressProjectRow);
    await page.getByTestId("sidebar-display-preferences-menu").click();
    await expect(page.getByTestId("sidebar-display-empty-project-sorting")).toContainText(
      "Custom order",
    );
    await expect(page.getByTestId("sidebar-display-sorting")).toHaveCount(0);
    await closeSidebarDisplayPreferences(page);
    await openSidebarDisplayPage(page, "sidebar-display-empty-project-sorting");
    await page.getByTestId("sidebar-empty-project-sorting-project").click();
    await expect.poll(() => rowTestIds(rows)).toEqual([alphaId, zetaId]);
    await page.reload();
    await expect.poll(() => rowTestIds(rows)).toEqual([alphaId, zetaId]);
    await openSidebarDisplayPage(page, "sidebar-display-empty-project-sorting");
    await page.getByTestId("sidebar-empty-project-sorting-custom").click();
    await expect.poll(() => rowTestIds(rows)).toEqual([zetaId, alphaId]);
    await expect.poll(() => rowTestIds(statusRows)).toEqual(initialWorkspaceOrder);
    await openSidebarDisplayPage(page, "sidebar-display-empty-workspaces");
    await page.getByTestId("sidebar-empty-workspaces-show").click();
    await page.getByTestId("sidebar-display-preferences-menu").click();
    await expect(page.getByTestId("sidebar-display-empty-project-sorting")).toHaveCount(0);
    await closeSidebarDisplayPreferences(page);
    await openSidebarDisplayPage(page, "sidebar-display-empty-workspaces");
    await page.getByTestId("sidebar-empty-workspaces-group").click();
    await expect.poll(() => rowTestIds(rows)).toEqual([zetaId, alphaId]);
    await openSidebarDisplayPage(page, "sidebar-display-empty-workspaces");
    await page.getByTestId("sidebar-empty-workspaces-hide").click();
    await page.getByTestId("sidebar-display-preferences-menu").click();
    await expect(page.getByTestId("sidebar-display-empty-project-sorting")).toHaveCount(0);
    await closeSidebarDisplayPreferences(page);
  } finally {
    await occupied.cleanup();
    await alpha.cleanup();
    await zeta.cleanup();
  }
});

/** Seed two workspace rows whose names expose alphabetical and saved drag order. */
async function seedSortableWorkspaceRows(page: Page) {
  const first = await seedWorkspace({ repoPrefix: "sidebar-workspace-sort-", title: "Zeta" });
  try {
    const created = await first.client.createWorkspace({
      source: { kind: "directory", path: first.repoPath, projectId: first.projectId },
      title: "Alpha",
    });
    if (!created.workspace) throw new Error(created.error ?? "Failed to create workspace");
    const zetaId = `sidebar-workspace-row-${getServerId()}:${first.workspaceId}`;
    const alphaId = `sidebar-workspace-row-${getServerId()}:${created.workspace.id}`;
    await gotoAppShell(page);
    await waitForSidebarHydration(page);
    return {
      rows: page.locator(`[data-testid="${alphaId}"], [data-testid="${zetaId}"]`),
      alphaId,
      zetaId,
      cleanup: first.cleanup,
    };
  } catch (error) {
    await first.cleanup();
    throw error;
  }
}

/** Verify that alphabetical sorting leaves drag order available and saved across reloads. */
async function expectWorkspaceSortingRestoresCustomOrder(
  page: Page,
  { rows, alphaId, zetaId }: Awaited<ReturnType<typeof seedSortableWorkspaceRows>>,
) {
  await openSidebarDisplayPage(page, "sidebar-display-workspace-sorting");
  await page.getByTestId("sidebar-workspace-sorting-name").click();
  await expect.poll(() => rowTestIds(rows)).toEqual([alphaId, zetaId]);
  await expectSortedDragBlocked(rows);
  await page.getByTestId("sidebar-display-preferences-menu").click();
  await expect(page.getByTestId("sidebar-display-workspace-sorting")).toContainText(
    "Workspace name",
  );
  await closeSidebarDisplayPreferences(page);
  await openSidebarDisplayPage(page, "sidebar-display-workspace-sorting");
  await page.getByTestId("sidebar-workspace-sorting-custom").click();
  if ((await rowTestIds(rows))[0] !== alphaId)
    await quickDragFirstRowAfterSecond(rows, pressWorkspaceRow);
  await expect.poll(() => rowTestIds(rows)).toEqual([alphaId, zetaId]);
  await quickDragFirstRowAfterSecond(rows, pressWorkspaceRow);
  await page.getByTestId("sidebar-display-preferences-menu").click();
  await expect(page.getByTestId("sidebar-display-workspace-sorting")).toContainText("Custom order");
  await closeSidebarDisplayPreferences(page);
  await openSidebarDisplayPage(page, "sidebar-display-workspace-sorting");
  await page.getByTestId("sidebar-workspace-sorting-name").click();
  await expect.poll(() => rowTestIds(rows)).toEqual([alphaId, zetaId]);
  await openSidebarDisplayPage(page, "sidebar-display-workspace-sorting");
  await page.getByTestId("sidebar-workspace-sorting-custom").click();
  await expect.poll(() => rowTestIds(rows)).toEqual([zetaId, alphaId]);
  await page.reload();
  await expect.poll(() => rowTestIds(rows)).toEqual([zetaId, alphaId]);
}

test("workspace sorting restores custom drag order in project grouping", async ({ page }) => {
  const seeded = await seedSortableWorkspaceRows(page);
  try {
    await expectWorkspaceSortingRestoresCustomOrder(page, seeded);
  } finally {
    await seeded.cleanup();
  }
});

test("workspace sorting restores custom drag order in status grouping", async ({ page }) => {
  const seeded = await seedSortableWorkspaceRows(page);
  try {
    await selectSidebarStatusGrouping(page);
    await expectWorkspaceSortingRestoresCustomOrder(page, seeded);
  } finally {
    await seeded.cleanup();
  }
});

test("status sorting puts the newest matching workspace first in project grouping", async ({
  page,
}, testInfo) => {
  const seeded = await seedSortableWorkspaceRows(page);
  try {
    await selectSidebarProjectGrouping(page);
    // Alpha was created second. Save the older Zeta first to distinguish recency from drag order.
    await openSidebarDisplayPage(page, "sidebar-display-workspace-sorting");
    await page.getByTestId("sidebar-workspace-sorting-name").click();
    await expect.poll(() => rowTestIds(seeded.rows)).toEqual([seeded.alphaId, seeded.zetaId]);
    await openSidebarDisplayPage(page, "sidebar-display-workspace-sorting");
    await page.getByTestId("sidebar-workspace-sorting-custom").click();
    if ((await rowTestIds(seeded.rows))[0] !== seeded.alphaId)
      await quickDragFirstRowAfterSecond(seeded.rows, pressWorkspaceRow);
    await expect.poll(() => rowTestIds(seeded.rows)).toEqual([seeded.alphaId, seeded.zetaId]);
    await quickDragFirstRowAfterSecond(seeded.rows, pressWorkspaceRow);
    await openSidebarDisplayPage(page, "sidebar-display-workspace-sorting");
    await page.getByTestId("sidebar-workspace-sorting-status").click();
    await expect.poll(() => rowTestIds(seeded.rows)).toEqual([seeded.alphaId, seeded.zetaId]);
    await page.screenshot({ path: testInfo.outputPath("project-status-newest-first.png") });
    await page.reload();
    await expect.poll(() => rowTestIds(seeded.rows)).toEqual([seeded.alphaId, seeded.zetaId]);
    await openSidebarDisplayPage(page, "sidebar-display-workspace-sorting");
    await page.getByTestId("sidebar-workspace-sorting-custom").click();
    await expect.poll(() => rowTestIds(seeded.rows)).toEqual([seeded.zetaId, seeded.alphaId]);
    await selectSidebarStatusGrouping(page);
    await openSidebarDisplayPage(page, "sidebar-display-workspace-sorting");
    await page.getByTestId("sidebar-workspace-sorting-status").click();
    await expect.poll(() => rowTestIds(seeded.rows)).toEqual([seeded.alphaId, seeded.zetaId]);
  } finally {
    await seeded.cleanup();
  }
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`status moves keep row identity, focus and rename drafts at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    const subject = await seedMockAgentWorkspace({
      repoPrefix: "sidebar-motion-subject-",
      title: "Subject",
      initialPrompt: "Finish.",
    });
    const other = await seedMockAgentWorkspace({
      repoPrefix: "sidebar-motion-other-",
      title: "Other",
      initialPrompt: "Finish.",
    });
    try {
      await subject.client.waitForFinish(subject.agentId, 20_000);
      await other.client.waitForFinish(other.agentId, 20_000);
      await subject.client.clearWorkspaceAttention(subject.workspaceId);
      await other.client.clearWorkspaceAttention(other.workspaceId);
      await page.setViewportSize(viewport);
      await seedSidebarMotionPreferences({ page, enabled: true });
      await gotoAppShell(page);
      if (viewport.width < 600) await openMobileAgentSidebar(page);
      const key = `${getServerId()}:${subject.workspaceId}`;
      const rowTestId = `sidebar-workspace-row-${key}`;
      const row = page.getByTestId(rowTestId);
      await expect(row).toBeVisible({ timeout: 30_000 });
      await expect(
        page.getByTestId(`sidebar-workspace-row-${getServerId()}:${other.workspaceId}`),
      ).toBeVisible();
      // Visibility starts during the compact drawer's entrance. Wait for real actionability
      // before measuring the independent row transition, without clicking or changing focus.
      await row.click({ trial: true });
      await row.focus();
      await page.screenshot({ path: testInfo.outputPath("motion-before.png") });
      await startSidebarMotionProbe({ page, rowTestId, freeze: true });
      await subject.client.markWorkspaceUnread(subject.workspaceId);
      await expectSidebarMotionPaused(page);
      await page.screenshot({ path: testInfo.outputPath("motion-middle.png") });
      await expect(row).toBeFocused();
      await resumeSidebarMotion(page);
      await expect
        .poll(async () =>
          row.evaluate(
            (node) => node.closest("[data-position-transition]")?.getAnimations().length ?? 0,
          ),
        )
        .toBe(0);
      await page.screenshot({ path: testInfo.outputPath("motion-after.png") });
      const frames = await stopSidebarMotionProbe(page);
      expect(frames.every((frame) => frame.connected && frame.sameNode)).toBe(true);
      expect(frames.some((frame) => frame.duration === 100)).toBe(true);
      expect(new Set(frames.map((frame) => Math.round(frame.top))).size).toBeGreaterThan(2);
      await testInfo.attach("motion-frames.json", {
        body: JSON.stringify(frames),
        contentType: "application/json",
      });

      await row.hover();
      await page.getByTestId(`sidebar-workspace-kebab-${key}`).click();
      await page.getByTestId(`sidebar-workspace-menu-rename-${key}`).click();
      const input = page.getByTestId(`sidebar-workspace-rename-modal-${key}-input`);
      await input.fill("Unsaved rename survives movement");
      await subject.client.clearWorkspaceAttention(subject.workspaceId);
      await expect(
        page.getByTestId("sidebar-status-group-rows-done").getByTestId(rowTestId),
      ).toBeVisible();
      await expect(input).toHaveValue("Unsaved rename survives movement");
      await expect(input).toBeFocused();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      if (viewport.width < 600) {
        await closeMobileAgentSidebar(page);
        await expectMobileAgentSidebarHidden(page);
        await subject.client.markWorkspaceUnread(subject.workspaceId);
        await expect(row.getByTestId("workspace-status-indicator-attention")).toHaveCount(1);
        await startSidebarMotionProbe({ page, rowTestId });
        await openMobileAgentSidebar(page);
        await expect(row).toBeInViewport();
        const revealedFrames = await stopSidebarMotionProbe(page);
        expect(revealedFrames.every((frame) => frame.duration === null && frame.sameNode)).toBe(
          true,
        );
        await page.screenshot({ path: testInfo.outputPath("hidden-status-reveal.png") });
      } else {
        await page.keyboard.press("Control+b");
        await expect(row).not.toBeVisible();
        await expect
          .poll(() =>
            row.evaluate((node) => {
              for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
                if (getComputedStyle(ancestor).display === "none") return true;
              }
              return false;
            }),
          )
          .toBe(true);
        await subject.client.markWorkspaceUnread(subject.workspaceId);
        await expect(row.getByTestId("workspace-status-indicator-attention")).toHaveCount(1);
        await startSidebarMotionProbe({ page, rowTestId });
        await page.keyboard.press("Control+b");
        await expect(row).toBeVisible();
        const revealedFrames = await stopSidebarMotionProbe(page);
        expect(revealedFrames.every((frame) => frame.duration === null && frame.sameNode)).toBe(
          true,
        );
        await page.screenshot({ path: testInfo.outputPath("desktop-hidden-status-reveal.png") });
      }
    } finally {
      await subject.cleanup();
      await other.cleanup();
    }
  });
}

for (const mode of ["off", "reduced"] as const) {
  test(`status moves instantly with motion ${mode} and retains the setting after reload`, async ({
    page,
  }) => {
    const subject = await seedMockAgentWorkspace({
      repoPrefix: "sidebar-motion-instant-",
      title: "Subject",
      initialPrompt: "Finish.",
    });
    try {
      await subject.client.waitForFinish(subject.agentId, 20_000);
      await subject.client.clearWorkspaceAttention(subject.workspaceId);
      await seedSidebarMotionPreferences({ page, enabled: true });
      await page.emulateMedia({ reducedMotion: mode === "reduced" ? "reduce" : "no-preference" });
      await gotoAppShell(page);
      if (mode === "off") {
        await page.goto("/settings/paseo-plus-plus");
        const toggle = page.getByRole("switch", { name: "Animate workspace moves", exact: true });
        await expect(toggle).toBeChecked();
        await toggle.click();
        await expect(toggle).not.toBeChecked();
        await gotoAppShell(page);
      }
      const rowTestId = `sidebar-workspace-row-${getServerId()}:${subject.workspaceId}`;
      await expect(page.getByTestId(rowTestId)).toBeVisible({ timeout: 30_000 });
      for (const reload of [false, true]) {
        if (reload) {
          await page.reload();
          await expect(page.getByTestId(rowTestId)).toBeVisible({ timeout: 30_000 });
        }
        await startSidebarMotionProbe({ page, rowTestId });
        await subject.client.markWorkspaceUnread(subject.workspaceId);
        await expect(
          page.getByTestId("sidebar-status-group-rows-attention").getByTestId(rowTestId),
        ).toBeVisible();
        const frames = await stopSidebarMotionProbe(page);
        expect(frames.every((frame) => frame.duration === null && frame.sameNode)).toBe(true);
        await subject.client.clearWorkspaceAttention(subject.workspaceId);
        await expect(
          page.getByTestId("sidebar-status-group-rows-done").getByTestId(rowTestId),
        ).toBeVisible();
      }
    } finally {
      await subject.cleanup();
    }
  });
}

test("rapid status reversal starts from the interrupted painted position", async ({ page }) => {
  const subject = await seedMockAgentWorkspace({
    repoPrefix: "sidebar-motion-interrupt-",
    title: "Subject",
    initialPrompt: "Finish.",
  });
  const other = await seedMockAgentWorkspace({
    repoPrefix: "sidebar-motion-interrupt-other-",
    title: "Other",
    initialPrompt: "Finish.",
  });
  try {
    await subject.client.waitForFinish(subject.agentId, 20_000);
    await other.client.waitForFinish(other.agentId, 20_000);
    await subject.client.clearWorkspaceAttention(subject.workspaceId);
    await other.client.clearWorkspaceAttention(other.workspaceId);
    await seedSidebarMotionPreferences({ page, enabled: true });
    await gotoAppShell(page);
    const rowTestId = `sidebar-workspace-row-${getServerId()}:${subject.workspaceId}`;
    const row = page.getByTestId(rowTestId);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await startSidebarMotionProbe({ page, rowTestId, freeze: true });
    await subject.client.markWorkspaceUnread(subject.workspaceId);
    await expectSidebarMotionPaused(page);
    const interruptedTop = (await row.boundingBox())!.y;
    await subject.client.clearWorkspaceAttention(subject.workspaceId);
    await expect(
      page.getByTestId("sidebar-status-group-rows-done").getByTestId(rowTestId),
    ).toBeVisible();
    await expect
      .poll(async () =>
        row.evaluate(
          (node) => node.closest("[data-position-transition]")?.getAnimations().length ?? 0,
        ),
      )
      .toBe(0);
    const frames = await stopSidebarMotionProbe(page);
    const firstReturn = frames.find(
      (frame, index) =>
        index > 0 &&
        frame.group === "sidebar-status-group-rows-done" &&
        frames
          .slice(0, index)
          .some((prior) => prior.group === "sidebar-status-group-rows-attention"),
    );
    expect(firstReturn).toBeDefined();
    expect(Math.abs(firstReturn!.top - interruptedTop)).toBeLessThan(12);
    expect(frames.every((frame) => frame.sameNode && frame.connected)).toBe(true);

    // The newly completed subject is first in Done. Changing only its bucket
    // keeps the same layout position and must not create artificial movement.
    const stationaryTop = (await row.boundingBox())!.y;
    await startSidebarMotionProbe({ page, rowTestId });
    await subject.client.markWorkspaceUnread(subject.workspaceId);
    await expect(
      page.getByTestId("sidebar-status-group-rows-attention").getByTestId(rowTestId),
    ).toBeVisible();
    const stationaryFrames = await stopSidebarMotionProbe(page);
    expect(stationaryFrames.length).toBeGreaterThan(0);
    expect(
      stationaryFrames.every(
        (frame) =>
          frame.duration === null &&
          frame.sameNode &&
          frame.connected &&
          Math.abs(frame.top - stationaryTop) < 1,
      ),
    ).toBe(true);
    await subject.client.clearWorkspaceAttention(subject.workspaceId);

    // Completing the other workspace puts it ahead of the subject. The next
    // bucket change now has real displacement for live reduced-motion cancellation.
    await other.client.markWorkspaceUnread(other.workspaceId);
    await other.client.clearWorkspaceAttention(other.workspaceId);
    const doneRows = page
      .getByTestId("sidebar-status-group-rows-done")
      .locator('[data-testid^="sidebar-workspace-row-"]');
    await expect
      .poll(() => rowTestIds(doneRows))
      .toEqual([`sidebar-workspace-row-${getServerId()}:${other.workspaceId}`, rowTestId]);
    await expect
      .poll(() =>
        row.evaluate(
          (node) => node.closest("[data-position-transition]")?.getAnimations().length ?? 0,
        ),
      )
      .toBe(0);
    await startSidebarMotionProbe({ page, rowTestId, freeze: true });
    await subject.client.markWorkspaceUnread(subject.workspaceId);
    await expectSidebarMotionPaused(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect
      .poll(async () =>
        row.evaluate(
          (node) => node.closest("[data-position-transition]")?.getAnimations().length ?? 0,
        ),
      )
      .toBe(0);
    const reducedFrames = await stopSidebarMotionProbe(page);
    expect(reducedFrames.every((frame) => frame.sameNode && frame.connected)).toBe(true);
  } finally {
    await subject.cleanup();
    await other.cleanup();
  }
});

test("collapsed destinations preserve drafts, collapse choices and conditional row focus", async ({
  page,
}) => {
  const subject = await seedMockAgentWorkspace({
    repoPrefix: "sidebar-motion-hidden-",
    title: "Subject",
    initialPrompt: "Finish.",
  });
  const other = await seedMockAgentWorkspace({
    repoPrefix: "sidebar-motion-hidden-other-",
    title: "Other",
    initialPrompt: "Finish.",
  });
  try {
    await subject.client.waitForFinish(subject.agentId, 20_000);
    await other.client.waitForFinish(other.agentId, 20_000);
    await subject.client.clearWorkspaceAttention(subject.workspaceId);
    await other.client.clearWorkspaceAttention(other.workspaceId);
    await other.client.markWorkspaceUnread(other.workspaceId);
    await seedSidebarMotionPreferences({ page, enabled: true });
    await gotoAppShell(page);
    const key = `${getServerId()}:${subject.workspaceId}`;
    const row = page.getByTestId(`sidebar-workspace-row-${key}`);
    const header = page.getByTestId("sidebar-status-group-attention");
    await expect(row).toBeVisible({ timeout: 30_000 });
    await header.click();
    const collapsedBefore = await page.evaluate(() =>
      localStorage.getItem("sidebar-collapsed-sections"),
    );
    await row.hover();
    await page.getByTestId(`sidebar-workspace-kebab-${key}`).click();
    await page.getByTestId(`sidebar-workspace-menu-rename-${key}`).click();
    const input = page.getByTestId(`sidebar-workspace-rename-modal-${key}-input`);
    await input.fill("Keep this hidden-row draft");
    await subject.client.markWorkspaceUnread(subject.workspaceId);
    await expect(row).toHaveCount(0);
    await expect(input).toHaveValue("Keep this hidden-row draft");
    await expect(input).toBeFocused();
    expect(await page.evaluate(() => localStorage.getItem("sidebar-collapsed-sections"))).toBe(
      collapsedBefore,
    );
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await subject.client.clearWorkspaceAttention(subject.workspaceId);
    await expect(row).toBeVisible();
    await row.focus();
    await subject.client.markWorkspaceUnread(subject.workspaceId);
    await expect(row).toHaveCount(0);
    await expect(header).toBeFocused();
    expect(await page.evaluate(() => localStorage.getItem("sidebar-collapsed-sections"))).toBe(
      collapsedBefore,
    );
    const collapsedKeys = await page.evaluate(() => {
      const stored = localStorage.getItem("sidebar-collapsed-sections");
      return stored ? JSON.parse(stored).state.collapsedWorkspaceGroupKeys : [];
    });
    expect(collapsedKeys).toContain("attention");
    await expect(page.getByTestId("sidebar-status-group-rows-attention")).toHaveCount(0);
  } finally {
    await subject.cleanup();
    await other.cleanup();
  }
});

test("project and child status moves count ancestor motion once, including a later child move", async ({
  page,
}, testInfo) => {
  const subject = await seedWorkspace({ repoPrefix: "sidebar-nested-motion-subject-" });
  const other = await seedWorkspace({ repoPrefix: "sidebar-nested-motion-other-" });
  async function finishedAgent(workspaceId: string, cwd: string, client: typeof subject.client) {
    const agent = await client.createAgent({
      provider: "mock",
      cwd,
      workspaceId,
      modeId: "load-test",
      model: "e2e-fast-stream",
      initialPrompt: "Finish.",
    });
    await client.waitForFinish(agent.id, 20_000);
    await client.clearWorkspaceAttention(workspaceId);
  }
  try {
    await finishedAgent(subject.workspaceId, subject.repoPath, subject.client);
    const sibling = await subject.client.createWorkspace({
      source: { kind: "directory", path: subject.repoPath, projectId: subject.projectId },
      title: "Sibling",
    });
    if (!sibling.workspace) throw new Error(sibling.error ?? "No sibling workspace");
    await finishedAgent(sibling.workspace.id, subject.repoPath, subject.client);
    await finishedAgent(other.workspaceId, other.repoPath, other.client);
    await seedSidebarMotionPreferences({ page, enabled: true, groupMode: "project" });
    await gotoAppShell(page);
    const subjectProjectId = `sidebar-project-row-${subject.projectKey}`;
    const otherProjectId = `sidebar-project-row-${other.projectKey}`;
    const projects = page.locator(
      `[data-testid="${subjectProjectId}"], [data-testid="${otherProjectId}"]`,
    );
    await expect(projects).toHaveCount(2);
    await openSidebarDisplayPage(page, "sidebar-display-sorting");
    await page.getByTestId("sidebar-sorting-custom").click();
    if ((await rowTestIds(projects))[0] === subjectProjectId)
      await quickDragFirstRowAfterSecond(projects, pressProjectRow);
    await openSidebarDisplayPage(page, "sidebar-display-sorting");
    await page.getByTestId("sidebar-sorting-status").click();
    await closeSidebarDisplayPreferences(page);
    const rowTestId = `sidebar-workspace-row-${getServerId()}:${subject.workspaceId}`;
    const siblingTestId = `sidebar-workspace-row-${getServerId()}:${sibling.workspace.id}`;
    const row = page.getByTestId(rowTestId);
    await expect(row).toBeVisible();
    const before = (await row.boundingBox())!.y;
    await page.screenshot({ path: testInfo.outputPath("nested-motion-before.png") });
    await startSidebarMotionProbe({ page, rowTestId, freeze: true });
    await subject.client.markWorkspaceUnread(subject.workspaceId);
    await expectSidebarMotionPaused(page);
    await page.screenshot({ path: testInfo.outputPath("nested-motion-middle.png") });
    await resumeSidebarMotion(page);
    await expect
      .poll(async () =>
        row.evaluate(
          (node) => node.closest("[data-position-transition]")?.getAnimations().length ?? 0,
        ),
      )
      .toBe(0);
    await expect.poll(() => rowTestIds(projects)).toEqual([subjectProjectId, otherProjectId]);
    const after = (await row.boundingBox())!.y;
    await page.screenshot({ path: testInfo.outputPath("nested-motion-after.png") });
    const frames = await stopSidebarMotionProbe(page);
    expect(after).toBeLessThan(before - 10);
    expect(Math.min(...frames.map((frame) => frame.top))).toBeGreaterThanOrEqual(after - 2);
    expect(Math.max(...frames.map((frame) => frame.top))).toBeLessThanOrEqual(before + 2);
    expect(frames.every((frame) => frame.sameNode && frame.connected)).toBe(true);
    await testInfo.attach("nested-motion-frames.json", {
      body: JSON.stringify(frames),
      contentType: "application/json",
    });

    await other.client.markWorkspaceUnread(other.workspaceId);
    await expect.poll(() => rowTestIds(projects)).toEqual([otherProjectId, subjectProjectId]);
    await expect
      .poll(async () =>
        page
          .getByTestId(subjectProjectId)
          .evaluate(
            (node) => node.closest("[data-position-transition]")?.getAnimations().length ?? 0,
          ),
      )
      .toBe(0);
    const beforeChildMove = (await row.boundingBox())!.y;
    await startSidebarMotionProbe({ page, rowTestId });
    await subject.client.markWorkspaceUnread(sibling.workspace.id);
    await expect
      .poll(() =>
        rowTestIds(page.locator(`[data-testid="${rowTestId}"], [data-testid="${siblingTestId}"]`)),
      )
      .toEqual([siblingTestId, rowTestId]);
    await expect
      .poll(async () =>
        row.evaluate(
          (node) => node.closest("[data-position-transition]")?.getAnimations().length ?? 0,
        ),
      )
      .toBe(0);
    const afterChildMove = (await row.boundingBox())!.y;
    const childFrames = await stopSidebarMotionProbe(page);
    expect(afterChildMove).toBeGreaterThan(beforeChildMove + 10);
    expect(Math.min(...childFrames.map((frame) => frame.top))).toBeGreaterThanOrEqual(
      beforeChildMove - 2,
    );
    expect(Math.max(...childFrames.map((frame) => frame.top))).toBeLessThanOrEqual(
      afterChildMove + 2,
    );
  } finally {
    await subject.cleanup();
    await other.cleanup();
  }
});

for (const destination of ["collapsed", "limit"] as const) {
  test(`a header clipped above the sidebar scrollport cannot receive focus for a ${destination} destination`, async ({
    page,
  }, testInfo) => {
    const subject = await seedMockAgentWorkspace({
      repoPrefix: "sidebar-clipped-focus-subject-",
      title: "Subject",
      initialPrompt: "Finish.",
    });
    const other = await seedMockAgentWorkspace({
      repoPrefix: "sidebar-clipped-focus-other-",
      title: "Other",
      initialPrompt: "Finish.",
    });
    try {
      await subject.client.waitForFinish(subject.agentId, 20_000);
      await other.client.waitForFinish(other.agentId, 20_000);
      await subject.client.setWorkspaceTitle(subject.workspaceId, "Zeta");
      await other.client.setWorkspaceTitle(other.workspaceId, "Alpha");
      await subject.client.clearWorkspaceAttention(subject.workspaceId);
      await other.client.clearWorkspaceAttention(other.workspaceId);
      for (let index = 0; index < 21; index++) {
        const workspace = await other.client.createWorkspace({
          source: { kind: "directory", path: other.cwd },
          title: `Alpha ${index}`,
        });
        if (!workspace.workspace)
          throw new Error(workspace.error ?? "Could not seed sidebar scroll range");
      }
      if (destination === "collapsed") await other.client.markWorkspaceUnread(other.workspaceId);
      else await subject.client.markWorkspaceUnread(subject.workspaceId);
      await seedSidebarMotionPreferences({
        page,
        enabled: true,
        workspaceSortMode: destination === "limit" ? "name" : "status",
      });
      await page.setViewportSize({ width: 1440, height: 900 });
      await gotoAppShell(page);
      const row = page.getByTestId(`sidebar-workspace-row-${getServerId()}:${subject.workspaceId}`);
      const bucket = destination === "collapsed" ? "attention" : "done";
      const header = page.getByTestId(`sidebar-status-group-${bucket}`);
      if (destination === "collapsed") {
        // Blank workspaces deliberately fill the initial limit. Reveal the source
        // during setup without changing the collapsed destination on status moves.
        await page.getByTestId("sidebar-status-group-show-more-done").click();
      }
      await expect(row).toBeVisible({ timeout: 30_000 });
      if (destination === "collapsed") await header.click();
      const collapseBefore = await page.evaluate(() =>
        localStorage.getItem("sidebar-collapsed-sections"),
      );
      await row.focus();
      await header.evaluate((element) => {
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          const overflow = getComputedStyle(parent).overflowY;
          if (overflow !== "auto" && overflow !== "scroll") continue;
          const headerBounds = element.getBoundingClientRect();
          const scrollBounds = parent.getBoundingClientRect();
          parent.scrollTop += headerBounds.bottom - scrollBounds.top + 1;
          return;
        }
        throw new Error("No sidebar scrollport");
      });
      const clipping = await header.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          const overflow = getComputedStyle(parent).overflowY;
          if (overflow === "auto" || overflow === "scroll")
            return {
              top: bounds.top,
              bottom: bounds.bottom,
              scrollTop: parent.getBoundingClientRect().top,
            };
        }
        throw new Error("No sidebar scrollport");
      });
      expect(clipping.top).toBeGreaterThan(0);
      expect(clipping.bottom).toBeLessThan(clipping.scrollTop);
      await expect(row).toBeFocused();
      await page.screenshot({ path: testInfo.outputPath(`${destination}-header-clipped.png`) });
      if (destination === "collapsed")
        await subject.client.markWorkspaceUnread(subject.workspaceId);
      else await subject.client.clearWorkspaceAttention(subject.workspaceId);
      await expect(row).toHaveCount(0);
      await expect(header).not.toBeFocused();
      expect(await page.evaluate(() => localStorage.getItem("sidebar-collapsed-sections"))).toBe(
        collapseBefore,
      );
      if (destination === "limit") {
        await expect(
          page
            .getByTestId("sidebar-status-group-rows-done")
            .locator('[data-testid^="sidebar-workspace-row-"]'),
        ).toHaveCount(20);
        await expect(page.getByTestId("sidebar-status-group-show-more-done")).toContainText(
          "Show more",
        );
      }
    } finally {
      await subject.cleanup();
      await other.cleanup();
    }
  });
}
