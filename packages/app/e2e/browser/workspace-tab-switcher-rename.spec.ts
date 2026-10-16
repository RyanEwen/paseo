import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "../support/fixtures";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { renameModalInput, renameModalSubmit } from "../support/helpers/rename";
import type { SeedDaemonClient } from "../support/helpers/seed-client";
import { buildSettingsSectionRoute } from "@/utils/host-routes";
import { WorkspaceLayoutPersistedStateSchema } from "@/stores/workspace-layout-storage";
import { collectAllTabs, findPaneById } from "@/stores/workspace-layout-actions";
import { getServerId } from "../support/helpers/server-id";
import { composerLocator } from "../support/helpers/composer";
import { clickSessionRow, expectSessionRowVisible } from "../support/helpers/archive-tab";

const MOBILE_VIEWPORT = { width: 390, height: 844 };

async function fetchAgentTitle(client: SeedDaemonClient, agentId: string): Promise<string | null> {
  const result = await client.fetchAgents({ scope: "active" });
  return result.entries.find((entry) => entry.agent.id === agentId)?.agent.title ?? null;
}

/** Read stable tab identities across named navigation and persisted layout hydration. */
function readTabIdentities(nodes: Element[]): Array<string | null> {
  return nodes.map((node) => node.getAttribute("data-testid"));
}

/** Change one central feature through its real settings control and restore the workspace route. */
async function toggleWorkspaceFeature(
  page: Page,
  feature: "mobileWorkspaceTabs" | "previousAgents",
) {
  const workspacePath = new URL(page.url()).pathname;
  await page.goto(buildSettingsSectionRoute("paseo-plus-plus"));
  const control = page.getByTestId(`paseo-plus-plus-${feature}`).getByRole("switch");
  await expect(control).toBeVisible();
  const wasEnabled = await control.isChecked();
  await control.click();
  if (wasEnabled) {
    await expect(control).not.toBeChecked();
  } else {
    await expect(control).toBeChecked();
  }
  await expect(control).toBeEnabled();
  await page.goto(workspacePath);
}

/** Read persisted identities and focused tab using the owning layout schema, without changing state. */
async function readWorkspaceTabSnapshot(page: Page, workspaceId: string) {
  const raw = await page.evaluate(() => localStorage.getItem("workspace-layout-state"));
  if (!raw) throw new Error("Expected the workspace layout to be persisted");
  const persisted = WorkspaceLayoutPersistedStateSchema.parse(JSON.parse(raw).state);
  const layout = persisted.layoutByWorkspace[`${getServerId()}:${workspaceId}`];
  if (!layout) throw new Error("Expected the active workspace layout");
  const pane = findPaneById(layout.root, layout.focusedPaneId);
  return {
    focusedTabId: pane?.focusedTabId,
    tabs: collectAllTabs(layout.root).map((tab) => ({ tabId: tab.tabId, target: tab.target })),
  };
}

/** Return tab identities without placing a nested array callback inside a polling assertion. */
async function readWorkspaceTabIds(page: Page, workspaceId: string) {
  return (await readWorkspaceTabSnapshot(page, workspaceId)).tabs.map((tab) => tab.tabId);
}

/** Wait for all compact overlays to dismiss before a product example capture. */
async function expectCompactOverlaysClosed(page: Page) {
  await expect(
    page.getByRole("button", { name: "Bottom sheet backdrop" }).filter({ visible: true }),
  ).toHaveCount(0);
}

/** Compact tabs keep visible session actions and present rename in the shared mobile sheet. */
test.describe("Workspace session rename (compact tabs)", () => {
  test("renames an agent session from its tab actions sheet", async ({ page }, testInfo) => {
    test.setTimeout(120_000);

    await page.setViewportSize(MOBILE_VIEWPORT);
    const initialTitle = `switcher-rename-${randomUUID().slice(0, 8)}`;
    const session = await seedMockAgentWorkspace({
      repoPrefix: "workspace-switcher-rename-",
      title: initialTitle,
    });

    try {
      await openAgentRoute(page, session);
      const tab = page.getByTestId(`workspace-tab-agent_${session.agentId}`);
      await expect(tab).toBeVisible({ timeout: 30_000 });
      await expect(tab).toHaveAttribute("aria-selected", "true");
      await expect(page.getByTestId("workspace-tabs-scroll")).toBeVisible();
      await expect(page.getByTestId("workspace-new-tab-button")).toBeVisible();

      const menuBase = `workspace-tab-menu-agent_${session.agentId}`;
      const actionsTrigger = page.getByTestId(`${menuBase}-trigger`);
      await expect(actionsTrigger).toBeVisible({ timeout: 15_000 });
      await actionsTrigger.click();

      const renameItem = page.getByTestId(`${menuBase}-rename`);
      await expect(renameItem).toBeVisible({ timeout: 10_000 });
      await renameItem.click();

      const modalPrefix = `workspace-tab-rename-modal-agent-${session.agentId}`;
      const input = renameModalInput(page, modalPrefix);
      await expect(input).toBeVisible({ timeout: 10_000 });
      await expect(input).toHaveValue(initialTitle);

      const renamed = "Renamed from the tab";
      await input.fill(renamed);
      await renameModalSubmit(page, modalPrefix).click();

      await expect(input).toHaveCount(0, { timeout: 15_000 });
      await expect(tab).toContainText(renamed, {
        timeout: 15_000,
      });
      await expect.poll(() => fetchAgentTitle(session.client, session.agentId)).toBe(renamed);
      await expect(page.getByText("Rename agent", { exact: true })).not.toBeVisible();
      await expect(
        page.getByRole("button", { name: "Bottom sheet backdrop" }).filter({ visible: true }),
      ).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath("compact-renamed-tab.png") });
    } finally {
      await session.cleanup();
    }
  });

  test("scrolls readable tabs and reveals new and selected tabs after rotation", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    const session = await seedMockAgentWorkspace({
      repoPrefix: "compact-tab-scroll-",
      title: "First compact workspace tab",
    });
    try {
      await openAgentRoute(page, session);
      const row = page.getByTestId("workspace-tabs-row");
      const first = row.getByTestId(`workspace-tab-agent_${session.agentId}`);
      await expect(first).toBeVisible({ timeout: 30_000 });
      const newTabs = row.locator('[data-testid^="workspace-tab-draft_"]');
      for (let index = 0; index < 5; index++) {
        await row.getByTestId("workspace-new-tab-button").click();
        await page.getByTestId("workspace-new-tab-menu-agent").filter({ visible: true }).click();
        await expect(newTabs).toHaveCount(index + 1);
        await expect(newTabs.last()).toHaveAttribute("aria-selected", "true");
        await expect(newTabs.last()).toBeInViewport({ ratio: 1 });
      }
      await expect(first).not.toBeInViewport();
      const latest = newTabs.last();
      const tabBox = await latest.boundingBox();
      const plusBox = await row.getByTestId("workspace-new-tab-button").boundingBox();
      expect(tabBox?.height).toBeGreaterThanOrEqual(44);
      expect(plusBox?.height).toBeGreaterThanOrEqual(44);

      // Compact intentionally disables keyboard shortcuts. Named workspace navigation selects
      // the existing session while preserving all newly opened tabs and their identities.
      const draftIdentities = await newTabs.evaluateAll(readTabIdentities);
      await openAgentRoute(page, session);
      await expect(first).toHaveAttribute("aria-selected", "true");
      await expect(first).toBeInViewport({ ratio: 1 });
      await expect(newTabs).toHaveCount(5);
      expect(await newTabs.evaluateAll(readTabIdentities)).toEqual(draftIdentities);
      await latest.click();
      await expect(latest).toHaveAttribute("aria-selected", "true");
      await expect(latest).toBeInViewport({ ratio: 1 });

      await page.setViewportSize({ width: 540, height: 390 });
      await expect(latest).toHaveAttribute("aria-selected", "true");
      await expect(latest).toBeInViewport({ ratio: 1 });
      await page.setViewportSize(MOBILE_VIEWPORT);
      await expect(latest).toBeInViewport({ ratio: 1 });
      await page.screenshot({ path: testInfo.outputPath("compact-scroll-selected.png") });
      await row.getByTestId("workspace-new-tab-button").click();
      await expect(
        page.getByTestId("workspace-new-tab-menu").filter({ visible: true }),
      ).toBeVisible();
    } finally {
      await session.cleanup();
    }
  });

  test("legacy opt-out preserves tab IDs and draft content, rename, close, and independent history", async ({
    page,
  }, testInfo) => {
    test.setTimeout(150_000);
    await page.setViewportSize(MOBILE_VIEWPORT);
    const session = await seedMockAgentWorkspace({
      title: "Release checklist",
      repoPrefix: "mobile-tabs-opt-out-",
    });
    try {
      await openAgentRoute(page, session);
      await page.getByTestId("workspace-new-tab-button").click();
      await page.getByTestId("workspace-new-tab-menu-agent").filter({ visible: true }).click();
      const draftText = "Keep this draft while changing workspace tab navigation";
      await composerLocator(page).fill(draftText);
      const before = await readWorkspaceTabSnapshot(page, session.workspaceId);
      await expectCompactOverlaysClosed(page);
      await page.screenshot({ path: testInfo.outputPath("mobileWorkspaceTabs-on.png") });

      await toggleWorkspaceFeature(page, "mobileWorkspaceTabs");
      const switcher = page.getByTestId("workspace-tab-switcher-trigger");
      await expect(switcher).toBeVisible();
      await expect(page.getByTestId("workspace-tabs-scroll")).toHaveCount(0);
      await expect(composerLocator(page)).toHaveValue(draftText);
      expect(await readWorkspaceTabSnapshot(page, session.workspaceId)).toEqual(before);
      await expect(switcher).toContainText("New Agent");
      await page.screenshot({ path: testInfo.outputPath("mobileWorkspaceTabs-off.png") });
      await switcher.click();
      await expect(page.getByText("Release checklist", { exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("mobileWorkspaceTabs-off-chooser.png") });
      await page.getByText("Release checklist", { exact: true }).click();
      await expect(switcher).toContainText("Release checklist");

      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(switcher).toHaveCount(0);
      await expect(
        page.getByTestId("workspace-tabs-scroll").filter({ visible: true }),
      ).toBeVisible();
      await page.setViewportSize(MOBILE_VIEWPORT);
      await expect(switcher).toContainText("Release checklist");

      // Restore the original draft selection before comparing presentation-only changes.
      await switcher.click();
      await page.getByText("New Agent", { exact: true }).click();
      await expect(composerLocator(page)).toHaveValue(draftText);
      await toggleWorkspaceFeature(page, "mobileWorkspaceTabs");
      await expect(page.getByTestId("workspace-tabs-scroll")).toBeVisible();
      await expect(switcher).toHaveCount(0);
      expect(await readWorkspaceTabSnapshot(page, session.workspaceId)).toEqual(before);
      await expect(composerLocator(page)).toHaveValue(draftText);

      await toggleWorkspaceFeature(page, "mobileWorkspaceTabs");
      await switcher.click();
      const original = before.tabs.find(
        (tab) => tab.target.kind === "agent" && tab.target.agentId === session.agentId,
      );
      if (!original) throw new Error("Expected the original agent tab");
      const menuBase = `workspace-tab-menu-${original.tabId}`;
      await page.getByTestId(`${menuBase}-trigger`).click();
      await page.getByTestId(`${menuBase}-rename`).click();
      const prefix = `workspace-tab-rename-modal-agent-${session.agentId}`;
      await renameModalInput(page, prefix).fill("Renamed through legacy chooser");
      await renameModalSubmit(page, prefix).click();
      await expect(page.getByText("Rename agent", { exact: true })).not.toBeVisible();
      // The nested rename sheet closes back to the existing chooser.
      await expect(page.getByText("Renamed through legacy chooser", { exact: true })).toBeVisible();
      await page.getByTestId(`${menuBase}-trigger`).click();
      await page.getByTestId(`${menuBase}-close`).click();
      await expect
        .poll(() => readWorkspaceTabIds(page, session.workspaceId))
        .not.toContain(original.tabId);
      // Closing a row can leave the chooser itself open. Dismiss it through its real backdrop.
      await page
        .getByRole("button", { name: "Bottom sheet backdrop" })
        .filter({ visible: true })
        .first()
        .click({ position: { x: 12, y: 12 } });
      await expectCompactOverlaysClosed(page);
      await page.getByTestId("workspace-header-menu-trigger").click();
      await page.getByTestId("workspace-new-tab-menu-reopen-closed-agent").click();
      await expectSessionRowVisible(page, "Renamed through legacy chooser");
      await clickSessionRow(page, "Renamed through legacy chooser");
      await expect(switcher).toContainText("Renamed through legacy chooser");

      await toggleWorkspaceFeature(page, "previousAgents");
      await expect(switcher).toBeVisible();
      await page.getByTestId("workspace-header-menu-trigger").click();
      await expect(page.getByTestId("workspace-new-tab-menu-reopen-closed-agent")).toHaveCount(0);
      await expect(page.getByTestId("workspace-header-new-agent")).toBeVisible();
      await expect(page.getByTestId("workspace-header-new-terminal")).toBeVisible();
    } finally {
      await session.cleanup();
    }
  });
});

test("wider tabs raise only the maximum and restore the earlier ceiling when disabled", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const session = await seedMockAgentWorkspace({
    repoPrefix: "wider-tabs-",
    title: "A long workspace conversation title that reaches the configured maximum tab width",
  });
  try {
    await openAgentRoute(page, session);
    const tab = page.getByTestId(`workspace-tab-agent_${session.agentId}`);
    await expect(tab).toBeVisible();
    const width = async () => (await tab.boundingBox())?.width ?? 0;
    await expect.poll(width).toBe(240);
    const evidence = resolve("../../docs/qa-evidence/wider-workspace-tabs");
    mkdirSync(evidence, { recursive: true });
    await page.screenshot({ path: resolve(evidence, "enabled.png") });
    const workspacePath = new URL(page.url()).pathname;
    await page.goto(buildSettingsSectionRoute("paseo-plus-plus"));
    const control = page.getByTestId("paseo-plus-plus-widerWorkspaceTabs").getByRole("switch");
    await expect(control).toBeChecked();
    await control.click();
    await expect(control).not.toBeChecked();
    await expect(control).toBeEnabled();
    await page.goto(workspacePath);
    await expect.poll(width).toBe(160);
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await page.screenshot({ path: resolve(evidence, "disabled.png") });
  } finally {
    await session.cleanup();
  }
});
