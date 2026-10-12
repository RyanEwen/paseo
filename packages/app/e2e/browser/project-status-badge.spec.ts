import { expect } from "@playwright/test";
import { test } from "../support/fixtures";
import {
  expandStatusProject,
  expectCollapsedProjectStatus,
  expectProjectStatusHidden,
  expectWorkspaceStatus,
  openAndCollapseStatusProject,
  seedStatusProject,
  startNeedsInputWorkspace,
  startWorkingWorkspace,
} from "../helpers/project-status-badge";

for (const chipsEnabled of [true, false]) {
  test(`a project surfaces its most urgent workspace status with activity chips ${chipsEnabled ? "on" : "off"}`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const project = await seedStatusProject();
    const projectRow = page.getByTestId(`sidebar-project-row-${project.seed.projectKey}`);
    const aggregateStatus = projectRow.getByRole("status");

    try {
      await page.addInitScript((enabled) => {
        const key = "@paseo:app-settings";
        const settings = JSON.parse(localStorage.getItem(key) ?? "{}");
        localStorage.setItem(
          key,
          JSON.stringify({
            ...settings,
            paseoPlusPlus: { ...settings.paseoPlusPlus, sidebarActivityChips: enabled },
          }),
        );
      }, chipsEnabled);
      await openAndCollapseStatusProject(page, project);
      if (chipsEnabled) {
        await expect(projectRow.getByRole("status", { name: "Done", exact: true })).toBeVisible();
        await expect(aggregateStatus).toHaveCount(1);
      } else {
        await expectProjectStatusHidden(page, project);
      }

      await startWorkingWorkspace(project);
      await expectCollapsedProjectStatus(page, project, "Working");
      await expect(aggregateStatus).toHaveCount(1);

      // The mixed project still has a working child; the urgent aggregate must replace Working.
      await startNeedsInputWorkspace(project);
      await expectCollapsedProjectStatus(page, project, "Needs input");
      await expect(aggregateStatus).toHaveCount(1);
      await expect(projectRow.getByRole("status", { name: "Working", exact: true })).toHaveCount(0);

      await expandStatusProject(page, project);
      if (chipsEnabled) {
        await expect(
          projectRow.getByRole("status", { name: "Needs input", exact: true }),
        ).toBeVisible();
        await expect(aggregateStatus).toHaveCount(1);
        await expect(projectRow.getByRole("status", { name: "Working", exact: true })).toHaveCount(
          0,
        );
      } else {
        // The disabled feature preserves the legacy collapsed-only icon status.
        await expectProjectStatusHidden(page, project);
      }
      await expectWorkspaceStatus(page, "Working workspace", "running");
      await expectWorkspaceStatus(page, "Needs input workspace", "needs_input");
    } finally {
      await project.seed.cleanup().catch(() => undefined);
    }
  });
}
