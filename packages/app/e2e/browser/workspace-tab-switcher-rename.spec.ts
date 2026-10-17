import type { TestInfo } from "@playwright/test";
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

test.use({ viewport: MOBILE_VIEWPORT, deviceScaleFactor: 2 });

async function openTabSwitcher(page: Page) {
  await page.getByRole("button", { name: /Switch tabs/ }).click();
  const footer = page.getByRole("button", { name: "New terminal", exact: true });
  await expect(footer).toBeVisible();
  // Visibility alone passes while the sheet is still travelling up from below the viewport.
  await expect
    .poll(async () => {
      const bounds = await footer.boundingBox();
      return bounds ? bounds.y + bounds.height : Number.POSITIVE_INFINITY;
    })
    .toBeLessThanOrEqual(MOBILE_VIEWPORT.height);
}

async function captureScreen(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({ path: testInfo.outputPath(name + ".png") });
}

async function createTabFromSwitcher(page: Page, kind: "New agent" | "New terminal") {
  await openTabSwitcher(page);
  await page.getByRole("button", { name: kind, exact: true }).click();
  await expect(page.getByRole("button", { name: "Bottom sheet backdrop" })).toHaveCount(0);
}

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

  test("upstream switcher opt-out preserves tab IDs and draft content, rename, close, and independent history", async ({
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
      await expect(switcher).toHaveText("2");
      await page.screenshot({ path: testInfo.outputPath("mobileWorkspaceTabs-off.png") });
      await switcher.click();
      await expect(page.getByText("Release checklist", { exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("mobileWorkspaceTabs-off-chooser.png") });
      await page.getByText("Release checklist", { exact: true }).click();
      await expect(switcher).toHaveText("2");

      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(switcher).toHaveCount(0);
      await expect(
        page.getByTestId("workspace-tabs-scroll").filter({ visible: true }),
      ).toBeVisible();
      await page.setViewportSize(MOBILE_VIEWPORT);
      await expect(switcher).toHaveText("2");

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
      await expect(switcher).toHaveText("2");

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

/**
 * Compact "sessions dropdown" rename path. The desktop rename specs drive the right-click
 * `workspace-tab-context-*` menu, which portals into overlay-root and was never broken. This
 * exercises the tab switcher's per-session actions on a phone-sized viewport — the path that
 * regressed when the actions menu presented as a popover instead of a bottom sheet.
 */
test.describe("Workspace session rename (compact tab switcher)", () => {
  test("renames an agent session from the switcher's per-session actions sheet", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);

    await page.setViewportSize(MOBILE_VIEWPORT);
    const initialTitle = `switcher-rename-${randomUUID().slice(0, 8)}`;
    const session = await seedMockAgentWorkspace({
      repoPrefix: "workspace-switcher-rename-",
      title: initialTitle,
    });

    try {
      await openAgentRoute(page, session);
      await toggleWorkspaceFeature(page, "mobileWorkspaceTabs");
      await expect(page.getByTestId("workspace-tab-switcher-trigger")).toBeVisible({
        timeout: 30_000,
      });

      await captureScreen(page, testInfo, "compact-chat-header");

      // Open the sessions dropdown (a bottom sheet on compact).
      await openTabSwitcher(page);
      await expect(page.getByRole("button", { name: "Bottom sheet backdrop" }).first()).toBeVisible(
        {
          timeout: 10_000,
        },
      );

      // Open this session's "…" actions. Before the fix this tried to open a popover-Modal
      // that never surfaced over the sheet on native; it now opens as a stacked sheet.
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

      const renamed = "Renamed from the dropdown";
      await input.fill(renamed);
      await renameModalSubmit(page, modalPrefix).click();

      await expect(input).toHaveCount(0, { timeout: 15_000 });
      await expect(page.getByText(renamed, { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByRole("button", { name: /Switch tabs/ })).toHaveText("1");
      await expect.poll(() => fetchAgentTitle(session.client, session.agentId)).toBe(renamed);
      await expect(page.getByRole("button", { name: "Bottom sheet backdrop" })).toHaveCount(1);
      await expect(page.getByText("Rename agent", { exact: true })).toBeHidden();
      await captureScreen(page, testInfo, "renamed-tab-in-switcher");
    } finally {
      await session.cleanup();
    }
  });
});

test("switcher footer creates tabs and returns to the existing chat", async ({
  page,
}, testInfo) => {
  const session = await seedMockAgentWorkspace({
    repoPrefix: "compact-header-actions-",
    title: "Existing chat",
  });
  try {
    await openAgentRoute(page, session);
    await toggleWorkspaceFeature(page, "mobileWorkspaceTabs");
    await expect(page.getByRole("button", { name: /Switch tabs/ })).toHaveText("1");

    await createTabFromSwitcher(page, "New terminal");
    await expect(page.getByRole("button", { name: /Switch tabs/ })).toHaveText("2");
    await expect(page.getByTestId("terminal-surface").filter({ visible: true })).toHaveCount(1);
    await captureScreen(page, testInfo, "compact-terminal-header");

    await createTabFromSwitcher(page, "New agent");
    await expect(page.getByRole("button", { name: /Switch tabs/ })).toHaveText("3");
    await expect(
      page.getByRole("textbox", { name: "Message agent..." }).filter({ visible: true }),
    ).toHaveCount(1);
    await captureScreen(page, testInfo, "compact-draft-header");

    await openTabSwitcher(page);
    await expect(page.getByText("Existing chat", { exact: true })).toBeVisible();
    await captureScreen(page, testInfo, "switcher-three-tabs");
    await page.getByText("Existing chat", { exact: true }).click();
    await expect(page.getByRole("button", { name: "Bottom sheet backdrop" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Switch tabs/ })).toHaveText("3");

    await openTabSwitcher(page);
    await expect(page.getByText("Existing chat", { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "Bottom sheet backdrop" })
      .click({ position: { x: 10, y: 10 } });
    await expect(page.getByRole("button", { name: "Bottom sheet backdrop" })).toHaveCount(0);
    await captureScreen(page, testInfo, "returned-chat-header");
  } finally {
    await session.cleanup();
  }
});
