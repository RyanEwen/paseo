import type { TestInfo } from "@playwright/test";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { seedWorkspace } from "../support/helpers/seed-client";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { getServerId } from "../support/helpers/server-id";

function workspaceRowTestId(workspaceId: string): string {
  return `sidebar-workspace-row-${getServerId()}:${workspaceId}`;
}

function workspaceRenameModalTestId(workspaceId: string, suffix: string): string {
  return `sidebar-workspace-rename-modal-${getServerId()}:${workspaceId}-${suffix}`;
}

async function openRenameModal(page: Page, workspaceId: string) {
  const serverId = getServerId();
  const row = page.getByTestId(`sidebar-workspace-row-${serverId}:${workspaceId}`);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.hover();

  const kebab = page.getByTestId(`sidebar-workspace-kebab-${serverId}:${workspaceId}`);
  await expect(kebab).toBeVisible({ timeout: 10_000 });
  await kebab.click();

  const renameItem = page.getByTestId(`sidebar-workspace-menu-rename-${serverId}:${workspaceId}`);
  await expect(renameItem).toBeVisible({ timeout: 10_000 });
  await renameItem.click();

  const input = page.getByTestId(workspaceRenameModalTestId(workspaceId, "input"));
  await expect(input).toBeVisible({ timeout: 10_000 });
  return input;
}

// In Model B the workspace title is its identity: renaming sets a custom title
// layered over the derived branch/directory name, and reconciliation never
// touches it. The sidebar row shows the title verbatim — no branch mutation.
test.describe("Sidebar workspace rename", () => {
  test("renaming via kebab sets a custom title that survives reload", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-rename-" });

    try {
      expect(workspace.workspaceName).toBe("main");

      await gotoAppShell(page);
      await expect(page.getByTestId(workspaceRowTestId(workspace.workspaceId))).toBeVisible({
        timeout: 30_000,
      });

      const input = await openRenameModal(page, workspace.workspaceId);
      await expect(input).toHaveValue("main");

      const customTitle = "Payments Refactor";
      await input.fill(customTitle);
      await page.getByTestId(workspaceRenameModalTestId(workspace.workspaceId, "submit")).click();

      await expect(input).toHaveCount(0, { timeout: 15_000 });
      // The title is shown exactly as typed — not slugified into a branch name.
      await expect(page.getByTestId(workspaceRowTestId(workspace.workspaceId))).toContainText(
        customTitle,
        { timeout: 15_000 },
      );

      // The custom title is backing metadata on the workspace: a full reload
      // re-resolves the descriptor from persistence and must not lose it. This
      // exercises the same descriptor resolution reconciliation re-runs against,
      // so a reconcile pass cannot overwrite the user's title either.
      await page.reload();
      await expect(page.getByTestId(workspaceRowTestId(workspace.workspaceId))).toContainText(
        customTitle,
        { timeout: 30_000 },
      );
    } finally {
      await workspace.cleanup();
    }
  });
});

async function toggleBackgroundWorkspaces(page: Page): Promise<void> {
  await page.getByLabel("Display preferences", { exact: true }).click();
  await page.getByRole("menuitem", { name: "Show background", exact: true }).click();
  await page.keyboard.press("Escape");
}

async function expectWorkspaceInSidebar(page: Page, workspaceId: string): Promise<void> {
  // Rows have no single accessible role: their nested title and actions share this container.
  await expect(page.getByTestId(workspaceRowTestId(workspaceId))).toBeVisible({ timeout: 30_000 });
}

async function expectWorkspaceHidden(page: Page, workspaceId: string): Promise<void> {
  await expect(page.getByTestId(workspaceRowTestId(workspaceId))).toHaveCount(0);
}

async function reconnectApp(page: Page): Promise<void> {
  await page.reload();
  await expect(page.getByLabel("Display preferences", { exact: true })).toBeVisible();
}

async function expectWorkerOpen(page: Page): Promise<void> {
  await expect(page.getByRole("textbox", { name: "Message agent..." })).toBeEditable({
    timeout: 30_000,
  });
  await expect(page.getByText("Background reviewer", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Background review prompt", { exact: true }).first()).toBeVisible();
}

/** Capture only after failure, so observation cannot change the navigation race under test. */
async function captureBackgroundWorkspaceFailure(input: {
  page: Page;
  testInfo: TestInfo;
  workspaceId: string;
  client: Pick<DaemonClient, "fetchWorkspaces">;
}): Promise<void> {
  const { page, testInfo, workspaceId, client } = input;
  const warnings: string[] = [];

  /** Keep every observation independent; one unavailable source must not hide the others. */
  async function observe(name: string, capture: () => Promise<void>): Promise<void> {
    try {
      await capture();
    } catch {
      warnings.push(`${name} unavailable`);
    }
  }

  await observe("browser state", async () => {
    const state = await page.evaluate(
      ({ serverId, workspaceId: focusedWorkspaceId, rowTestId }) => {
        interface LoadedModule {
          isInitialized?: boolean;
          verboseName?: string;
          publicModule?: { exports?: Record<string, unknown> };
        }
        const runtime = Reflect.get(globalThis, "__r") as
          | { getModules?: () => Map<number, LoadedModule> }
          | undefined;
        const modules = runtime?.getModules?.();

        // Read only initialized exports. Requiring a module could create state after failure.
        function loadedExport(path: string, name: string): unknown {
          if (!modules) return undefined;
          for (const module of modules.values()) {
            const modulePath = module.verboseName?.replaceAll("\\", "/");
            if (module.isInitialized && modulePath?.endsWith(path)) {
              return module.publicModule?.exports?.[name];
            }
          }
          return undefined;
        }

        const sidebar = loadedExport("src/stores/sidebar-view-store.ts", "useSidebarViewStore") as
          | { getState(): { showBackground: boolean }; persist: { hasHydrated(): boolean } }
          | undefined;
        const sync = loadedExport("src/settings-sync/runtime.ts", "settingsSync") as
          | { getState(): { selectedHost: string | null; status: string }; getGeneration(): number }
          | undefined;
        const sessions = loadedExport("src/stores/session-store.ts", "useSessionStore") as
          | {
              getState(): {
                sessions: Record<string, { workspaces: Map<string, { background: boolean }> }>;
              };
            }
          | undefined;
        const workspace = sessions
          ?.getState()
          .sessions[serverId]?.workspaces.get(focusedWorkspaceId);

        /** Project a single approved storage field, never the complete settings blob. */
        function persistedField(key: "sidebar-view" | "app-settings-sync", field: string) {
          const raw = localStorage.getItem(key);
          if (raw === null) return { available: false, value: null };
          try {
            const stored = JSON.parse(raw);
            const value = key === "sidebar-view" ? stored.state?.[field] : stored[field];
            const scalar =
              key === "sidebar-view"
                ? typeof value === "boolean"
                : typeof value === "string" || value === null;
            return { available: scalar, value: scalar ? value : null };
          } catch {
            return { available: false, value: null };
          }
        }

        return {
          serverId,
          workspaceId: focusedWorkspaceId,
          rowTestId,
          rowCount: document.querySelectorAll(`[data-testid="${rowTestId}"]`).length,
          sidebarModuleAvailable: sidebar !== undefined,
          showBackground: sidebar?.getState().showBackground ?? null,
          hydrated: sidebar?.persist.hasHydrated() ?? null,
          persistedShowBackground: persistedField("sidebar-view", "showBackground"),
          syncModuleAvailable: sync !== undefined,
          selectedHost: sync?.getState().selectedHost ?? null,
          syncStatus: sync?.getState().status ?? null,
          syncGeneration: sync?.getGeneration() ?? null,
          persistedSelectedHost: persistedField("app-settings-sync", "selectedHost"),
          sessionModuleAvailable: sessions !== undefined,
          replicaWorkspaceAvailable: workspace !== undefined,
          replicaBackground: workspace?.background ?? null,
        };
      },
      { serverId: getServerId(), workspaceId, rowTestId: workspaceRowTestId(workspaceId) },
    );
    if (!state.sidebarModuleAvailable) warnings.push("Initialized sidebar module unavailable");
    if (!state.syncModuleAvailable) warnings.push("Initialized settings sync module unavailable");
    if (!state.sessionModuleAvailable) warnings.push("Initialized session module unavailable");
    await testInfo.attach("background-workspace-state-before-cleanup", {
      body: JSON.stringify(state, null, 2),
      contentType: "application/json",
    });
  });
  await observe("failure screenshot", async () => {
    const path = testInfo.outputPath("background-failure-before-cleanup.png");
    await page.screenshot({ path });
    await testInfo.attach("background-failure-before-cleanup", { path, contentType: "image/png" });
  });
  await observe("failure DOM", async () => {
    await testInfo.attach("background-failure-dom-before-cleanup", {
      body: await page.content(),
      contentType: "text/html",
    });
  });
  await observe("fresh daemon workspace", async () => {
    const requestId = `background-failure-${randomUUID()}`;
    const result = await client.fetchWorkspaces({ includeBackground: true, requestId });
    const workspace = result.entries.find((entry) => entry.id === workspaceId);
    await testInfo.attach("background-workspace-fresh-daemon", {
      body: JSON.stringify(
        {
          requestId,
          workspaceId,
          found: workspace !== undefined,
          background: workspace?.background ?? null,
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
  });
  if (warnings.length > 0) {
    try {
      await testInfo.attach("background-workspace-diagnostic-warning", {
        body: warnings.join("\n"),
        contentType: "text/plain",
      });
    } catch {
      console.warn("Background workspace diagnostic warning attachment unavailable");
    }
  }
}

test("background workspace stays directly accessible across sidebar toggles and reconnect", async ({
  page,
}, testInfo) => {
  const workspace = await seedWorkspace({
    repoPrefix: "sidebar-background-",
    title: "Background review",
    background: true,
  });
  try {
    const worker = await workspace.client.createAgent({
      provider: "mock",
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Background reviewer",
      initialPrompt: "Background review prompt",
      model: "e2e-fast-stream",
      modeId: "load-test",
    });
    await test.step("Default sidebar hides background work", async () => {
      await gotoAppShell(page);
      await expectWorkspaceHidden(page, workspace.workspaceId);
    });
    await test.step("Show background exposes the fully replicated workspace", async () => {
      await toggleBackgroundWorkspaces(page);
      await expectWorkspaceInSidebar(page, workspace.workspaceId);
      await reconnectApp(page);
      await expectWorkspaceInSidebar(page, workspace.workspaceId);
    });
    await test.step("Direct agent navigation survives hiding and reconnect", async () => {
      await toggleBackgroundWorkspaces(page);
      await expectWorkspaceHidden(page, workspace.workspaceId);
      await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: worker.id });
      await expectWorkerOpen(page);
      await expectWorkspaceHidden(page, workspace.workspaceId);
      await reconnectApp(page);
      await expectWorkerOpen(page);
      await expectWorkspaceHidden(page, workspace.workspaceId);
      await page.screenshot({ path: testInfo.outputPath("background-direct-open.png") });
    });
  } catch (error) {
    try {
      // The seed handle uses the real daemon SDK; only failure diagnostics request its full inventory.
      await captureBackgroundWorkspaceFailure({
        page,
        testInfo,
        workspaceId: workspace.workspaceId,
        client: workspace.client as unknown as Pick<DaemonClient, "fetchWorkspaces">,
      });
    } catch {
      // Preserve the assertion even if an unexpected diagnostic failure escapes its observation guard.
      try {
        await testInfo.attach("background-workspace-diagnostic-warning", {
          body: "Background workspace diagnostics unavailable",
          contentType: "text/plain",
        });
      } catch {
        console.warn("Background workspace diagnostics unavailable");
      }
    }
    throw error;
  } finally {
    await workspace.cleanup();
  }
});
