import { expect, test, type Page } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { projectEquivalenceViewKey } from "../support/helpers/project-view-key";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { waitForSidebarHydration } from "../support/helpers/workspace-ui";

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

async function closeMenuSheet(page: Page): Promise<void> {
  const backdrop = page.getByRole("button", { name: "Bottom sheet backdrop" }).first();
  await backdrop.click({ position: { x: 12, y: 12 } });
  await expect(backdrop).not.toBeVisible({ timeout: 10_000 });
}

test("project and workspace kebabs open action sheets on compact layouts", async ({
  page,
}, testInfo) => {
  const seeded = await seedWorkspace({ repoPrefix: "sidebar-mobile-menu-sheet-" });

  try {
    await gotoAppShell(page);
    await page.getByRole("button", { name: "Open menu", exact: true }).click();
    await waitForSidebarHydration(page);

    await page
      .getByTestId(`sidebar-project-kebab-${projectEquivalenceViewKey(seeded.projectKey)}`)
      .click();

    await expect(page.getByRole("button", { name: "Bottom sheet backdrop" }).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("Project actions", { exact: true })).toBeVisible();
    await closeMenuSheet(page);

    const workspaceRow = page.getByTestId(
      `sidebar-workspace-row-${getServerId()}:${seeded.workspaceId}`,
    );
    await workspaceRow.hover();
    await workspaceRow
      .getByTestId(`sidebar-workspace-kebab-${getServerId()}:${seeded.workspaceId}`)
      .click();

    await expect(page.getByRole("button", { name: "Bottom sheet backdrop" }).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("Workspace actions", { exact: true })).toBeVisible();
    const key = `${getServerId()}:${seeded.workspaceId}`;
    await expect(page.getByTestId(`sidebar-workspace-menu-pin-${key}`)).toHaveText(
      "Pin to sidebar top",
    );
    await page.getByTestId(`sidebar-workspace-menu-project-pin-${key}`).click();
    await expect
      .poll(
        async () =>
          (await seeded.client.fetchWorkspaces()).entries.find(
            (entry) => entry.id === seeded.workspaceId,
          )?.projectPinnedAt,
      )
      .toBeTruthy();
    await expect(page.getByTestId("sidebar-pinned-section")).toHaveCount(0);
    await workspaceRow.getByTestId(`sidebar-workspace-kebab-${key}`).click();
    await expect(page.getByTestId(`sidebar-workspace-menu-project-pin-${key}`)).toHaveText(
      "Unpin in project",
    );
    const projectPinItem = page.getByTestId(`sidebar-workspace-menu-project-pin-${key}`);
    await expect
      .poll(async () => {
        const bounds = await projectPinItem.boundingBox();
        return bounds !== null && bounds.y >= 0 && bounds.y + bounds.height < 844;
      })
      .toBe(true);
    await page.screenshot({ path: testInfo.outputPath("project-pin-compact-menu.png") });
  } finally {
    await seeded.cleanup();
  }
});
