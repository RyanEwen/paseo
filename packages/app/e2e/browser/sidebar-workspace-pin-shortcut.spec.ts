import { test, expect, type Page } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import {
  expectNewWorkspaceProjectSelected,
  openNewWorkspaceComposer,
} from "../support/helpers/new-workspace";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { openWorkspaceContextMenu, selectSidebarStatusGrouping } from "../support/helpers/sidebar";

// The pin shortcut used to be registered by the sidebar row itself, so it silently did nothing
// whenever the row was unmounted — a collapsed project section being the common case. It now
// lives in a single always-mounted handler keyed on the active route selection.
const PIN_SHORTCUT = "ControlOrMeta+Shift+P";

function workspaceRow(page: Page, workspaceId: string) {
  return page.getByTestId(`sidebar-workspace-row-${getServerId()}:${workspaceId}`);
}

function pinnedSection(page: Page) {
  return page.getByTestId("sidebar-pinned-section");
}

// Opens the workspace so it becomes the active route selection, which is what the shortcut acts on.
async function openWorkspace(page: Page, workspaceId: string) {
  const row = workspaceRow(page, workspaceId);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await expect(page).toHaveURL(/\/workspace\//, { timeout: 30_000 });
}

// The project key is host-scoped and not exposed by the seed helper, so the header is addressed by
// its display name, scoped to project rows so a workspace row can never match. Pressing the header
// toggles the section, which unmounts every workspace row under it.
async function collapseProjectSection(page: Page, project: SeededWorkspace): Promise<void> {
  const header = page
    .locator('[data-testid^="sidebar-project-row-"]')
    .filter({ hasText: project.projectDisplayName });
  await expect(header).toHaveCount(1, { timeout: 30_000 });

  await header.click();
  await expect(workspaceRow(page, project.workspaceId)).toHaveCount(0, { timeout: 10_000 });
}

async function switchToStatusGrouping(page: Page): Promise<void> {
  await selectSidebarStatusGrouping(page);
  await expect(page.getByTestId("sidebar-status-list-scroll")).toBeVisible({ timeout: 10_000 });
}

// Status mode buckets workspaces by state rather than project, so the group holding this workspace
// is discovered from the rows container it sits in rather than assumed.
async function collapseStatusGroupContaining(page: Page, workspaceId: string): Promise<void> {
  const rows = page
    .locator('[data-testid^="sidebar-status-group-rows-"]')
    .filter({ has: workspaceRow(page, workspaceId) });
  await expect(rows).toHaveCount(1, { timeout: 30_000 });

  const rowsTestId = await rows.getAttribute("data-testid");
  const bucket = rowsTestId?.replace("sidebar-status-group-rows-", "");
  expect(bucket).toBeTruthy();

  await page.getByTestId(`sidebar-status-group-${bucket}`).click();
  await expect(workspaceRow(page, workspaceId)).toHaveCount(0, { timeout: 10_000 });
}

function readSessionMessage(
  message: string | Buffer,
): { type?: unknown; requestId?: unknown } | null {
  const raw = typeof message === "string" ? message : message.toString("utf8");
  try {
    const envelope = JSON.parse(raw) as { type?: unknown; message?: unknown };
    if (envelope.type !== "session" || typeof envelope.message !== "object") {
      return null;
    }
    return envelope.message as { type?: unknown; requestId?: unknown };
  } catch {
    return null;
  }
}

const PIN_REJECTION_MESSAGE = "Pin rejected by test.";

interface PinRpcGate {
  /** Pin requests the client has sent so far. */
  sentCount(): number;
}

// Proxies everything so the app boots against the real daemon, counting pin RPCs and optionally
// rejecting the first `rejectFirst` of them. The count asserts how many pins one keypress actually
// dispatched, which the rendered pin state cannot show — a toggle that fired twice lands back
// where it started.
async function installPinRpcGate(
  page: Page,
  options: { rejectFirst?: number; projectPinsUnsupported?: boolean } = {},
): Promise<PinRpcGate> {
  const rejectFirst = options.rejectFirst ?? 0;
  let sent = 0;

  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();

    ws.onMessage((message) => {
      const sessionMessage = readSessionMessage(message);
      if (
        sessionMessage?.type === "workspace.pin.set.request" &&
        typeof sessionMessage.requestId === "string"
      ) {
        sent += 1;
        if (sent <= rejectFirst) {
          ws.send(
            JSON.stringify({
              type: "session",
              message: {
                type: "rpc_error",
                payload: {
                  requestId: sessionMessage.requestId,
                  requestType: "workspace.pin.set.request",
                  error: PIN_REJECTION_MESSAGE,
                  code: "transport",
                },
              },
            }),
          );
          return;
        }
      }

      try {
        server.send(message);
      } catch {
        // server socket already closed
      }
    });

    server.onMessage((message) => {
      try {
        if (options.projectPinsUnsupported) {
          const envelope = JSON.parse(message.toString()) as {
            type: string;
            message?: {
              type?: string;
              payload?: { status?: string; features?: Record<string, boolean> };
            };
          };
          // Keep a real connected host, but advertise the capability shape of an older daemon.
          const status = envelope.message;
          if (
            envelope.type === "session" &&
            status?.type === "status" &&
            status.payload?.status === "server_info"
          ) {
            if (status.payload.features) delete status.payload.features.projectWorkspacePinning;
            ws.send(JSON.stringify(envelope));
            return;
          }
        }
        ws.send(message);
      } catch {
        // client socket already closed
      }
    });
  });

  return { sentCount: () => sent };
}

test.describe("Pin workspace shortcut", () => {
  test("dispatches pin once and keeps project creation reachable", async ({ page }) => {
    const workspace = await seedWorkspace({
      repoPrefix: "pin-project-creation-",
      title: "Pinned workspace",
    });

    try {
      const gate = await installPinRpcGate(page);

      await gotoAppShell(page);
      await openWorkspace(page, workspace.workspaceId);

      await test.step("sends one RPC for each pin transition", async () => {
        await page.keyboard.press(PIN_SHORTCUT);
        await expect(pinnedSection(page)).toBeVisible({ timeout: 10_000 });
        expect(gate.sentCount()).toBe(1);

        await page.keyboard.press(PIN_SHORTCUT);
        await expect(pinnedSection(page)).toHaveCount(0, { timeout: 10_000 });
        expect(gate.sentCount()).toBe(2);
        await expect(workspaceRow(page, workspace.workspaceId)).toHaveCount(1);
      });

      await test.step("keeps the pinned project available to workspace creation", async () => {
        await page.keyboard.press(PIN_SHORTCUT);
        await expect(pinnedSection(page)).toBeVisible({ timeout: 10_000 });
        expect(gate.sentCount()).toBe(3);

        await openNewWorkspaceComposer(page, workspace);
        await expectNewWorkspaceProjectSelected(page, workspace.projectDisplayName);
      });
    } finally {
      await workspace.cleanup();
    }
  });

  test("pins the active workspace while its project section is collapsed", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "pin-shortcut-collapsed-" });

    try {
      await gotoAppShell(page);
      await openWorkspace(page, workspace.workspaceId);
      await collapseProjectSection(page, workspace);

      await page.keyboard.press(PIN_SHORTCUT);

      await expect(pinnedSection(page)).toBeVisible({ timeout: 10_000 });
      await expect(
        pinnedSection(page).getByTestId(
          `sidebar-workspace-row-${getServerId()}:${workspace.workspaceId}`,
        ),
      ).toBeVisible();
    } finally {
      await workspace.cleanup();
    }
  });

  test("unpins the active workspace while the Pinned section is collapsed", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "pin-shortcut-unpin-" });

    try {
      await gotoAppShell(page);
      await openWorkspace(page, workspace.workspaceId);

      await page.keyboard.press(PIN_SHORTCUT);
      await expect(pinnedSection(page)).toBeVisible({ timeout: 10_000 });

      await page.getByTestId("sidebar-pinned-section-header").click();
      await expect(workspaceRow(page, workspace.workspaceId)).toHaveCount(0, { timeout: 10_000 });

      await page.keyboard.press(PIN_SHORTCUT);

      await expect(pinnedSection(page)).toHaveCount(0, { timeout: 10_000 });
    } finally {
      await workspace.cleanup();
    }
  });

  test("pins the active workspace while its status group is collapsed", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "pin-shortcut-status-" });

    try {
      await gotoAppShell(page);
      await openWorkspace(page, workspace.workspaceId);
      await switchToStatusGrouping(page);
      await collapseStatusGroupContaining(page, workspace.workspaceId);

      await page.keyboard.press(PIN_SHORTCUT);

      await expect(pinnedSection(page)).toBeVisible({ timeout: 10_000 });
      await expect(
        pinnedSection(page).getByTestId(
          `sidebar-workspace-row-${getServerId()}:${workspace.workspaceId}`,
        ),
      ).toBeVisible();
    } finally {
      await workspace.cleanup();
    }
  });

  test("shows an error toast when the host rejects the pin, and the next press succeeds", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({ repoPrefix: "pin-shortcut-failure-" });

    try {
      const gate = await installPinRpcGate(page, { rejectFirst: 1 });

      await gotoAppShell(page);
      await openWorkspace(page, workspace.workspaceId);

      await page.keyboard.press(PIN_SHORTCUT);

      await expect(page.getByTestId("app-toast-message")).toContainText(PIN_REJECTION_MESSAGE, {
        timeout: 10_000,
      });
      await expect(pinnedSection(page)).toHaveCount(0);
      await expect(workspaceRow(page, workspace.workspaceId)).toHaveCount(1);

      // The failure must leave the action usable: the in-flight guard has to release the key so a
      // retry is not swallowed. Without that release the workspace is unpinnable for the session.
      await page.keyboard.press(PIN_SHORTCUT);

      await expect(pinnedSection(page)).toBeVisible({ timeout: 10_000 });
      expect(gate.sentCount()).toBe(2);
    } finally {
      await workspace.cleanup();
    }
  });
});

test("project pin menu persists, syncs, and switches exclusively with global pins", async ({
  page,
}, testInfo) => {
  const workspace = await seedWorkspace({ repoPrefix: "project-pin-menu-", title: "Project pin" });
  try {
    const sibling = await workspace.client.createWorkspace({
      source: { kind: "directory", path: workspace.repoPath, projectId: workspace.projectId },
      title: "Ordinary sibling",
    });
    expect(sibling.workspace).toBeTruthy();
    await gotoAppShell(page);
    await openWorkspace(page, workspace.workspaceId);
    const key = `${getServerId()}:${workspace.workspaceId}`;
    await openWorkspaceContextMenu(page, workspace.workspaceId);
    await expect(page.getByTestId(`sidebar-workspace-menu-pin-${key}`)).toHaveText(
      "Pin to sidebar top",
    );
    await page.getByTestId(`sidebar-workspace-menu-project-pin-${key}`).click();
    const readPin = async () =>
      (await workspace.client.fetchWorkspaces()).entries.find(
        (entry) => entry.id === workspace.workspaceId,
      );
    await expect.poll(async () => (await readPin())?.projectPinnedAt).toBeTruthy();
    expect((await readPin())?.pinnedAt).toBeNull();
    await expect(pinnedSection(page)).toHaveCount(0);
    await expect(workspaceRow(page, workspace.workspaceId)).toHaveCount(1);
    const ids = await page
      .locator('[data-testid^="sidebar-workspace-row-"]')
      .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-testid")));
    expect(ids.indexOf(`sidebar-workspace-row-${key}`)).toBeLessThan(
      ids.indexOf(`sidebar-workspace-row-${getServerId()}:${sibling.workspace!.id}`),
    );
    await page.screenshot({ path: testInfo.outputPath("project-pin-desktop.png") });
    await page.reload();
    await expect(workspaceRow(page, workspace.workspaceId)).toBeVisible({ timeout: 30_000 });
    await openWorkspaceContextMenu(page, workspace.workspaceId);
    await expect(page.getByTestId(`sidebar-workspace-menu-project-pin-${key}`)).toHaveText(
      "Unpin in project",
    );
    await page.screenshot({ path: testInfo.outputPath("project-pin-menu.png") });
    await page.getByTestId(`sidebar-workspace-menu-pin-${key}`).click();
    await expect(pinnedSection(page)).toBeVisible();
    await expect.poll(async () => (await readPin())?.projectPinnedAt).toBeNull();
    await openWorkspaceContextMenu(page, workspace.workspaceId);
    await page.getByTestId(`sidebar-workspace-menu-project-pin-${key}`).click();
    await expect(pinnedSection(page)).toHaveCount(0);
    await switchToStatusGrouping(page);
    await expect(workspaceRow(page, workspace.workspaceId)).toHaveCount(1);
    expect((await readPin())?.projectPinnedAt).toBeTruthy();
    await openWorkspaceContextMenu(page, workspace.workspaceId);
    await page.getByTestId(`sidebar-workspace-menu-project-pin-${key}`).click();
    await expect.poll(async () => (await readPin())?.projectPinnedAt).toBeNull();
  } finally {
    await workspace.cleanup();
  }
});

test("project pin rejection leaves the action retryable without changing global pin state", async ({
  page,
}) => {
  const workspace = await seedWorkspace({ repoPrefix: "project-pin-failure-" });
  try {
    const gate = await installPinRpcGate(page, { rejectFirst: 1 });
    await gotoAppShell(page);
    await openWorkspace(page, workspace.workspaceId);
    const key = `${getServerId()}:${workspace.workspaceId}`;
    await openWorkspaceContextMenu(page, workspace.workspaceId);
    await page.getByTestId(`sidebar-workspace-menu-project-pin-${key}`).click();
    await expect(page.getByTestId("app-toast-message")).toContainText(PIN_REJECTION_MESSAGE);
    await expect(pinnedSection(page)).toHaveCount(0);
    await openWorkspaceContextMenu(page, workspace.workspaceId);
    await page.getByTestId(`sidebar-workspace-menu-project-pin-${key}`).click();
    await expect
      .poll(
        async () =>
          (await workspace.client.fetchWorkspaces()).entries.find(
            (entry) => entry.id === workspace.workspaceId,
          )?.projectPinnedAt,
      )
      .toBeTruthy();
    expect(gate.sentCount()).toBe(2);
    await expect(pinnedSection(page)).toHaveCount(0);
  } finally {
    await workspace.cleanup();
  }
});

test("project pin asks for a host update when its capability is absent", async ({ page }) => {
  const workspace = await seedWorkspace({ repoPrefix: "project-pin-old-host-" });
  try {
    const gate = await installPinRpcGate(page, { projectPinsUnsupported: true });
    await gotoAppShell(page);
    await openWorkspace(page, workspace.workspaceId);
    const key = `${getServerId()}:${workspace.workspaceId}`;
    await openWorkspaceContextMenu(page, workspace.workspaceId);
    await page.getByTestId(`sidebar-workspace-menu-project-pin-${key}`).click();
    await expect(page.getByTestId("app-toast-message")).toContainText(
      "Update this host to pin workspaces in a project.",
    );
    expect(gate.sentCount()).toBe(0);
    await page.keyboard.press(PIN_SHORTCUT);
    await expect(pinnedSection(page)).toBeVisible();
    expect(gate.sentCount()).toBe(1);
  } finally {
    await workspace.cleanup();
  }
});
