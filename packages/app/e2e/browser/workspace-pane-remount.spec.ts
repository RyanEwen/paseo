import { WorkspaceLayoutPersistedStateSchema } from "@/stores/workspace-layout-storage";
import { collectAllPanes, collectAllTabs } from "@/stores/workspace-layout-actions";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createMockIdleAgent, openWorkspaceWithAgents } from "../support/helpers/archive-tab";
import {
  buildDefaultSettingsRoute,
  buildHostAgentDetailRoute,
  buildHostWorkspaceRoute,
} from "@/utils/host-routes";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { createIdleAgent } from "../support/helpers/archive-tab";
import { expectComposerVisible } from "../support/helpers/composer";
import { clickNewTerminal, terminalSurfaceLocator } from "../support/helpers/launcher";
import { renameModalInput } from "../support/helpers/rename";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { clickSettingsBackToWorkspace, openCompactSettings } from "../support/helpers/settings";
import { openSettings } from "../support/helpers/app";
import { expectAppRoute } from "../support/helpers/route-assertions";
import { runWorkspaceActionFromCommandCenter } from "../support/helpers/command-center-workspace-actions";
import {
  clickFirstTerminalTab,
  waitForWorkspaceTabsVisible,
} from "../support/helpers/workspace-tabs";
import { expectTerminalSurfaceVisible } from "../support/helpers/terminal-perf";

async function captureRenderedNode(locator: Locator) {
  await expect(locator).toBeVisible({ timeout: 30_000 });
  const node = await locator.elementHandle();
  if (!node) {
    throw new Error("Expected rendered node");
  }
  return node;
}

async function expectSameRenderedNode(
  original: Awaited<ReturnType<typeof captureRenderedNode>>,
  locator: Locator,
) {
  const current = await captureRenderedNode(locator);
  await expect(original.evaluate((node, candidate) => node === candidate, current)).resolves.toBe(
    true,
  );
}

async function expectNodeConnected(node: Awaited<ReturnType<typeof captureRenderedNode>>) {
  expect(await node.evaluate((candidate) => candidate.isConnected)).toBe(true);
}

async function getSettingsShortcut(page: Page) {
  return page.evaluate(() =>
    navigator.platform.toLowerCase().includes("mac") ? "Meta+," : "Control+,",
  );
}

async function waitForWorkspaceRoute(page: Page, route: string) {
  await page.waitForURL((url) => url.pathname === route);
}

test.describe("Workspace pane mounting", () => {
  test("workspace navigation keeps the existing agent composer mounted", async ({ page }) => {
    test.setTimeout(90_000);
    const serverId = getServerId();

    const workspace = await seedWorkspace({ repoPrefix: "pane-remount-" });

    try {
      const agent = await createIdleAgent(workspace.client, {
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: `pane-remount-${Date.now()}`,
      });

      await page.goto(buildHostAgentDetailRoute(serverId, agent.id, agent.workspaceId));
      await page.waitForURL(
        (url) => url.pathname.includes("/workspace/") && !url.searchParams.has("open"),
        { timeout: 60_000 },
      );
      await waitForWorkspaceTabsVisible(page);
      await expectComposerVisible(page);

      const originalComposer = await page
        .getByTestId("message-input-root")
        .filter({ visible: true })
        .first()
        .elementHandle();
      expect(originalComposer).not.toBeNull();
      await test.step("opening the first split pane preserves the composer", async () => {
        const emptyPanesBeforeSplit = await page.getByTestId("workspace-new-tab-panel").count();

        await runWorkspaceActionFromCommandCenter(page, "Split pane right");
        await expect(page.getByTestId("workspace-new-tab-panel")).toHaveCount(
          emptyPanesBeforeSplit + 1,
          { timeout: 30_000 },
        );
        await expect(page.getByTestId("message-input-root").filter({ visible: true })).toHaveCount(
          1,
        );
        await expectNodeConnected(originalComposer!);
      });

      const composer = page.getByTestId("message-input-root").filter({ visible: true }).first();
      await test.step("desktop Settings closes overlays and preserves the composer", async () => {
        const tab = page.getByTestId(`workspace-tab-agent_${agent.id}`).first();
        await tab.click({ button: "right" });
        await page.getByTestId(`workspace-tab-context-agent_${agent.id}-rename`).click();
        const renameInput = renameModalInput(page, `workspace-tab-rename-modal-agent-${agent.id}`);
        await expect(renameInput).toBeVisible();

        const settingsShortcut = await getSettingsShortcut(page);
        await page.keyboard.press(settingsShortcut);
        await expectAppRoute(page, buildDefaultSettingsRoute());
        await expect(renameInput).not.toBeVisible();
        await clickSettingsBackToWorkspace(page);
        await expectSameRenderedNode(originalComposer!, composer);
      });
    } finally {
      await workspace.cleanup();
    }
  });

  test("opening Settings on a compact layout keeps the agent composer mounted", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 480, height: 900 });
    const serverId = getServerId();
    const workspace = await seedWorkspace({ repoPrefix: "compact-settings-pane-retention-" });

    try {
      const agent = await createIdleAgent(workspace.client, {
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: `compact-settings-pane-retention-${Date.now()}`,
      });
      const agentRoute = buildHostAgentDetailRoute(serverId, agent.id, agent.workspaceId);

      await page.goto(agentRoute);
      await expectComposerVisible(page);
      const composer = page.getByTestId("message-input-root").filter({ visible: true }).first();
      const originalComposer = await captureRenderedNode(composer);

      const workspaceRoute = buildHostWorkspaceRoute(serverId, workspace.workspaceId);
      await openCompactSettings(page, workspaceRoute);
      await page.goBack();
      await waitForWorkspaceRoute(page, workspaceRoute);
      await expectSameRenderedNode(originalComposer, composer);
    } finally {
      await workspace.cleanup();
    }
  });

  test("workspace navigation keeps the terminal emulator mounted", async ({ page }) => {
    test.setTimeout(90_000);
    const serverId = getServerId();
    const workspace = await seedWorkspace({ repoPrefix: "terminal-pane-retention-" });

    try {
      const agent = await createIdleAgent(workspace.client, {
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: `terminal-pane-retention-${Date.now()}`,
      });

      await page.goto(buildHostAgentDetailRoute(serverId, agent.id, agent.workspaceId));
      await waitForWorkspaceTabsVisible(page);
      await clickNewTerminal(page);
      await expectTerminalSurfaceVisible(page);
      const terminalSurface = terminalSurfaceLocator(page);
      const originalTerminal = await captureRenderedNode(terminalSurface);

      await test.step("switching tabs preserves the terminal", async () => {
        await page.getByTestId(`workspace-tab-agent_${agent.id}`).click();
        await expectComposerVisible(page);
        await expectNodeConnected(originalTerminal);

        await clickFirstTerminalTab(page);
        await expectSameRenderedNode(originalTerminal, terminalSurface);
      });

      await test.step("opening Settings preserves the terminal", async () => {
        await openSettings(page);
        await clickSettingsBackToWorkspace(page);
        await expectSameRenderedNode(originalTerminal, terminalSurface);
      });
    } finally {
      await workspace.cleanup();
    }
  });
});

/** Read the newly created draft’s persisted identity without changing the layout. */
async function readSplitDraft(page: Page, workspaceId: string) {
  const raw = await page.evaluate(() => localStorage.getItem("workspace-layout-state"));
  if (!raw) return null;
  const state = WorkspaceLayoutPersistedStateSchema.parse(JSON.parse(raw).state);
  const layout = state.layoutByWorkspace[`${getServerId()}:${workspaceId}`];
  if (!layout) return null;
  const tab = collectAllTabs(layout.root).find((item) => item.target.kind === "draft");
  if (!tab || tab.target.kind !== "draft") return null;
  const pane = collectAllPanes(layout.root).find((item) => item.tabIds.includes(tab.tabId));
  return { tabId: tab.tabId, draftId: tab.target.draftId, paneId: pane?.id };
}

test("tab move menus and divider presets preserve workspace tabs", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const workspace = await seedWorkspace({ repoPrefix: "split-presets-" });
  try {
    const first = await createMockIdleAgent(workspace.client, {
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Left conversation",
    });
    const second = await createMockIdleAgent(workspace.client, {
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Right conversation",
    });
    await openWorkspaceWithAgents(page, [first, second]);
    const main = page.getByTestId("workspace-pane-main");
    const originalComposer = await captureRenderedNode(main.getByTestId("message-input-root"));
    const countBefore = await main.getByRole("tab").count();
    await main.getByTestId("workspace-new-tab-button").click();
    await page.getByTestId("workspace-new-tab-split-agent").click();
    await expect(page.getByTestId(/^workspace-new-tab-layout-agent-/)).toHaveCount(20);
    await expect(main.getByRole("tab")).toHaveCount(countBefore);
    const splitEvidence = resolve("../../docs/qa-evidence/workspace-split-presets");
    mkdirSync(splitEvidence, { recursive: true });
    await page.screenshot({ path: resolve(splitEvidence, "creation-split-choices.png") });
    await page.getByTestId("workspace-new-tab-layout-agent-right-60-40").click();
    await expect.poll(() => readSplitDraft(page, workspace.workspaceId)).not.toBeNull();
    const draft = await readSplitDraft(page, workspace.workspaceId);
    if (!draft?.paneId) throw new Error("Expected new draft in its own split");
    await expectSameRenderedNode(originalComposer, main.getByTestId("message-input-root"));
    await expect(page.getByTestId(`workspace-pane-${draft.paneId}`)).toBeVisible();
    await page.getByTestId(`workspace-tab-${draft.draftId}`).hover();
    await page.getByTestId(`workspace-draft-close-${draft.draftId}`).click();
    await expect(page.getByTestId("workspace-split-resize-handle")).toHaveCount(0);
    const tabId = `agent_${second.id}`;
    const tab = page.getByTestId(`workspace-tab-${tabId}`);
    await expect(tab).toBeVisible();
    await tab.click({ button: "right" });
    const menu = `workspace-tab-move-${tabId}`;
    await page.getByTestId(menu).click();
    await page.getByTestId(`${menu}-right`).click();
    await page.getByTestId(`${menu}-right-60-40`).click();
    const left = page.getByTestId("workspace-pane-main");
    const right = page
      .getByTestId(/^workspace-pane-/)
      .filter({ has: page.getByTestId(`workspace-tab-${tabId}`) });
    const ratio = async () => {
      const a = await left.boundingBox();
      const b = await right.boundingBox();
      if (!a || !b) throw new Error("Expected both split panes");
      return a.width / (a.width + b.width);
    };
    await expect.poll(ratio).toBeGreaterThan(0.58);
    await expect.poll(ratio).toBeLessThan(0.62);
    const divider = page.getByTestId("workspace-split-resize-handle");
    await divider.hover();
    await expect(page.getByTestId("workspace-split-presets")).toBeVisible();
    const evidence = resolve("../../docs/qa-evidence/workspace-split-presets");
    mkdirSync(evidence, { recursive: true });
    await page.screenshot({ path: resolve(evidence, "divider-presets.png") });
    await page.getByTestId("workspace-split-preset-50-50").click();
    await expect.poll(ratio).toBeGreaterThan(0.48);
    await expect.poll(ratio).toBeLessThan(0.52);
    await tab.click({ button: "right" });
    await page.getByTestId(menu).click();
    await page.screenshot({ path: resolve(evidence, "tab-move-menu.png") });
    await page.getByTestId(`${menu}-pane-main`).click();
    await expect(left.getByTestId(`workspace-tab-agent_${first.id}`)).toBeVisible();
    await expect(left.getByTestId(`workspace-tab-${tabId}`)).toBeVisible();
    await expect(page.getByTestId("workspace-split-resize-handle")).toHaveCount(0);
  } finally {
    await workspace.cleanup();
  }
});
