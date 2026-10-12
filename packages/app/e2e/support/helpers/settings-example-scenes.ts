import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { buildHostWorkspaceRoute } from "@/utils/host-routes";
import { DEFAULT_PASEO_PLUS_PLUS_PREFERENCES } from "@/paseo-plus-plus/preferences";
import { gotoAppShell, openSettings } from "./app";
import { openWorkspaceContextMenu, selectSidebarStatusGrouping } from "./sidebar";
import { seedWorkspace } from "./seed-client";
import { getServerId } from "./server-id";
import {
  closeWorkspaceAgentTab,
  createMockIdleAgent,
  openWorkspaceWithAgents,
} from "./archive-tab";
import { ensureExplorerSidebar, openChangesTreePanel } from "./workspace-tabs";
import { seedMockAgentWorkspace } from "./mock-agent";
import {
  openAgentTimeline,
  expectTimelinePromptVisible,
  scrollTimelinePastPrompt,
} from "./timeline-pagination";
import { recordSettingsExample } from "./settings-example-capture";

/** Capture the real closed-agent picker in its own bounded fixture, independent of other scenes. */
export async function capturePreviousAgentsExample(page: Page, directory: string) {
  const workspace = await seedWorkspace({
    repoPrefix: "settings-previous-example-",
    title: "Paseo app",
  });
  try {
    const history = await createMockIdleAgent(workspace.client, {
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Review the settings page",
    });
    const survivor = await createMockIdleAgent(workspace.client, {
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Improve sidebar controls",
    });
    await openWorkspaceWithAgents(page, [history, survivor]);
    await closeWorkspaceAgentTab(page, history.id);
    await page.getByTestId("workspace-new-tab-button").click();
    await page.getByTestId("workspace-new-tab-menu-reopen-closed-agent").click();
    const content = page.getByTestId("reopen-closed-agent-dialog-content");
    const search = page.getByTestId("reopen-closed-agent-search");
    await expect(content).toContainText(history.title);
    await recordSettingsExample(page, {
      id: "previous-agents",
      directory,
      regions: [content, search],
      description:
        "A previously closed agent is available to reopen. Search belongs to the dialog header.",
    });
  } finally {
    await workspace.cleanup();
  }
}

/** Capture actual Explorer and Changes output; this illustrates the shared group, not every trigger. */
export async function captureExplorerExample(page: Page, directory: string) {
  const workspace = await seedWorkspace({
    repoPrefix: "settings-explorer-example-",
    title: "Paseo app",
    repo: { files: [{ path: "settings.ts", content: "export const statusLabel = 'Done';\n" }] },
  });
  try {
    await writeFile(
      join(workspace.repoPath, "settings.ts"),
      "export const statusLabel = 'Working';\n",
    );
    const refresh = await workspace.client.checkoutRefresh(workspace.repoPath);
    expect(refresh.success).toBe(true);
    await page.goto(buildHostWorkspaceRoute(getServerId(), workspace.workspaceId));
    const explorer = await ensureExplorerSidebar(page);
    await openChangesTreePanel(page);
    const file = explorer.getByText("settings.ts", { exact: true }).first();
    await expect(file).toBeVisible();
    await recordSettingsExample(page, {
      id: "explorer-changes-list",
      directory,
      regions: [explorer],
      description: "Explorer's Changes view lists a modified file.",
    });
    await file.click();
    const diff = page.getByTestId("git-diff-scroll").filter({ visible: true }).first();
    await expect(diff).toBeVisible();
    await expect(
      page.getByTestId("git-diff-canvas").filter({ visible: true }).first(),
    ).toBeVisible();
    await recordSettingsExample(page, {
      id: "explorer-changes-diff",
      directory,
      regions: [diff],
      description:
        "A real working-copy diff. This is shared Explorer/Changes output, not proof of automatic opening or switching.",
    });
  } finally {
    await workspace.cleanup();
  }
}

/** Capture the qualified single-copy sticky surface after a real transcript scroll. */
export async function captureStickyExample(page: Page, directory: string) {
  const prompt = "Keep the current request visible while reading the response.";
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "settings-sticky-example-",
    title: "Sticky request example",
    initialPrompt: prompt,
    featureValues: {
      mockStreamingAssistantResponse: Array.from(
        { length: 30 },
        (_, index) =>
          `Paragraph ${index + 1}. Review the workspace controls and preserve saved preferences.`,
      ).join("\n\n"),
      mockStreamingAssistantIntervalMs: 1,
    },
  });
  try {
    await openAgentTimeline(page, agent);
    await expectTimelinePromptVisible(page, prompt);
    await expect(page.getByText("Paragraph 30.", { exact: false }).last()).toBeVisible();
    await scrollTimelinePastPrompt(page, prompt);
    const sticky = page.getByTestId("sticky-user-message");
    await expect(sticky).toContainText(prompt);
    await recordSettingsExample(page, {
      id: "sticky-user-prompts",
      directory,
      regions: [sticky],
      description:
        "The actual single-copy pinned request above a scrolled response. Physical native paint is not tested.",
    });
  } finally {
    await agent.cleanup();
  }
}

/** Recapture only sidebar controls. The pin image shows the real entry point, not stored pin priority. */
export async function captureSidebarControlsExample(page: Page, directory: string) {
  const workspace = await seedWorkspace({
    repoPrefix: "settings-sidebar-example-",
    title: "Improve settings",
  });
  const other = await seedWorkspace({
    repoPrefix: "settings-docs-example-",
    title: "Review documentation",
  });
  try {
    // Current full overview is independent of sidebar crops and is persisted immediately.
    await page.setViewportSize({ width: 1440, height: 3000 });
    await gotoAppShell(page);
    await openSettings(page);
    const section = page.getByTestId("paseo-plus-plus-settings");
    const switches = section.getByTestId("paseo-plus-plus-features").getByRole("switch");
    const visibleCount = Object.keys(DEFAULT_PASEO_PLUS_PLUS_PREFERENCES).filter(
      (feature) => feature !== "androidAutomaticUpdateChecks",
    ).length;
    await expect(switches).toHaveCount(visibleCount);
    for (let index = 0; index < visibleCount; index += 1)
      await expect(switches.nth(index)).toBeChecked();
    await expect(section.getByTestId("settings-sync")).toBeVisible();
    await expect(section.getByTestId("sidebar-workspace-limit-mode")).toBeVisible();
    await expect(
      section.getByText("Independent fork installations", { exact: true }),
    ).toBeInViewport();
    await recordSettingsExample(page, {
      id: "settings-overview-current-all-on",
      directory,
      description:
        "Actual current Paseo++ page with nine visible default-On feature controls, sync and workspace limit. Android automatic checks remain platform-only.",
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await workspace.client.renameProject(workspace.projectId, "Paseo app");
    await other.client.renameProject(other.projectId, "Documentation");
    const agent = await workspace.client.createAgent({
      provider: "mock",
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Improve settings",
      model: "one-minute-stream",
      initialPrompt: "Stay busy",
    });
    await workspace.client.waitForAgentUpsert(
      agent.id,
      (snapshot) => snapshot.status === "running",
      15_000,
    );
    await gotoAppShell(page);
    const project = page.getByTestId(`sidebar-project-row-${workspace.projectKey}`);
    const chip = page.getByTestId(`sidebar-project-status-${workspace.projectKey}`);
    await expect(chip).toContainText(/working/i);
    await recordSettingsExample(page, {
      id: "project-header",
      directory,
      regions: [project],
      description:
        "A real project title and live working activity chip. Shared image for title emphasis and activity chips.",
    });
    const expand = page.getByTestId("sidebar-expand-all");
    const collapse = page.getByTestId("sidebar-collapse-all");
    await recordSettingsExample(page, {
      id: "bulk-actions",
      directory,
      regions: [expand, collapse],
      description: "The actual expand-all and collapse-all controls.",
    });
    await page.getByTestId("sidebar-project-selector").click();
    const selector = page.getByTestId("sidebar-project-selector-content");
    await expect(selector).toContainText("Documentation");
    await expect(selector).toContainText("Paseo app");
    await recordSettingsExample(page, {
      id: "project-selector",
      directory,
      regions: [selector],
      description: "The real multi-select project dropdown with live project activity.",
    });
    await page.keyboard.press("Escape");
    await openWorkspaceContextMenu(page, workspace.workspaceId);
    const menu = page.getByTestId(
      `sidebar-workspace-context-menu-${getServerId()}:${workspace.workspaceId}`,
    );
    await expect(menu).toContainText("Pin in project");
    await recordSettingsExample(page, {
      id: "project-pin",
      directory,
      regions: [menu],
      description:
        "The actual Pin in project menu entry. This still does not demonstrate saved priority or reorder behavior.",
    });
  } finally {
    await other.cleanup();
    await workspace.cleanup();
  }
}

/** Record settled positions on each side of a real status change; stills do not demonstrate timing. */
export async function captureWorkspacePositionsExample(page: Page, directory: string) {
  const workspace = await seedWorkspace({
    repoPrefix: "settings-position-example-",
    title: "Review settings",
  });
  try {
    await gotoAppShell(page);
    await selectSidebarStatusGrouping(page);
    const row = page.getByTestId(`sidebar-workspace-row-${getServerId()}:${workspace.workspaceId}`);
    await expect(row).toBeVisible();
    const done = page.getByTestId("sidebar-status-group-rows-done").filter({ has: row });
    await expect(done).toContainText("Review settings");
    await recordSettingsExample(page, {
      id: "workspace-positions-before",
      directory,
      regions: [done],
      description:
        "Settled position in Done before the agent starts. A still cannot show transition duration.",
    });
    const agent = await workspace.client.createAgent({
      provider: "mock",
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Review settings",
      model: "one-minute-stream",
      initialPrompt: "Stay busy",
    });
    await workspace.client.waitForAgentUpsert(
      agent.id,
      (snapshot) => snapshot.status === "running",
      15_000,
    );
    const working = page.getByTestId("sidebar-status-group-rows-running").filter({ has: row });
    await expect(working).toContainText("Review settings");
    await recordSettingsExample(page, {
      id: "workspace-positions-after",
      directory,
      regions: [working],
      description:
        "Settled position in Working after the actual status change. Use alongside Before; motion qualification remains separate.",
    });
  } finally {
    await workspace.cleanup();
  }
}
