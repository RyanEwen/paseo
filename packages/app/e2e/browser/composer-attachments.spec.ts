import type { Locator } from "@playwright/test";
import {
  expectSingleLineStickyGeometry,
  expectInlineStickyAttachmentCount,
} from "../support/helpers/sticky-preview-geometry";
import { chatOutlineRail } from "../support/helpers/chat-outline";
import { expect, test } from "../support/fixtures";
import { clickNewChat } from "../support/helpers/launcher";
import { expectComposerVisible } from "../support/helpers/composer";
import { expectAgentIdle } from "../support/helpers/agent-stream";
import {
  openAttachmentMenu,
  expectAttachmentSheetRowsOnTitleRail,
  openGithubPickerFromMenu,
  attachImageFromMenu,
  expectAttachmentPill,
  removeAttachmentPill,
  openImageLightbox,
  closeImageLightbox,
  pressInterruptShortcut,
  expectComposerDraft,
  expectComposerDisabled,
  expectComposerEditable,
  expectAttachButtonDisabled,
  fillComposerDraft,
  submitMessageWithButton,
  dropFileOnComposer,
  sendDraftToQueue,
  expectQueuedMessageButton,
  startRunningMockAgent,
  selectGithubOption,
  expectGithubAttachmentPill,
  openGithubWorkspace,
} from "../support/helpers/composer";
import {
  delayBrowserAgentCreatedStatus,
  openNewWorkspaceComposer,
} from "../support/helpers/new-workspace";
import { gotoAppShell } from "../support/helpers/app";
import {
  waitForSidebarHydration,
  switchWorkspaceViaSidebar,
} from "../support/helpers/workspace-ui";
import { seedWorkspace } from "../support/helpers/seed-client";
import { hasGithubAuth, createTempGithubRepo } from "../support/helpers/github-fixtures";
import { getServerId } from "../support/helpers/server-id";
import { openFileExplorer } from "../support/helpers/file-explorer";
import { attachFileFromMenu, controlFileUploadCompletion } from "../support/helpers/composer";

import {
  openAgentTimeline,
  seedLongMockAgentTimeline,
  scrollTimelinePastPrompt,
  expectTimelinePromptLandedBelowTop,
} from "../support/helpers/timeline-pagination";

const MINIMAL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

const TEST_IMAGE = { name: "test.png", mimeType: "image/png", buffer: MINIMAL_PNG };
const TEST_JSON = {
  name: "config.json",
  mimeType: "application/json",
  buffer: Buffer.from(JSON.stringify({ composer: "drop" })),
};

/** An outline tick exists only once the prompt has a canonical timeline sequence. */
async function outlinePromptSequence(entry: Locator): Promise<number> {
  await expect(entry).toHaveAttribute("data-testid", /^chat-outline-tick-\d+$/);
  const tickId = await entry.getAttribute("data-testid");
  return Number(tickId!.slice("chat-outline-tick-".length));
}

test.describe("Composer attachments", () => {
  test("selected file shows a loading attachment until upload is acknowledged", async ({
    page,
    withWorkspace,
  }) => {
    const upload = await controlFileUploadCompletion(page);
    const workspace = await withWorkspace({ prefix: "attach-upload-pending-" });
    await workspace.navigateTo();
    await clickNewChat(page);
    await expectComposerVisible(page);

    upload.hold();
    await attachFileFromMenu(page, TEST_JSON);
    await upload.waitForUpload();

    const pending = page.getByTestId("composer-pending-file-attachment");
    await expect(pending).toContainText(TEST_JSON.name);
    await expect(pending.getByRole("progressbar")).toBeVisible();
    await expect(page.getByTestId("composer-file-attachment-pill")).toHaveCount(0);

    upload.complete();
    await expect(pending).toHaveCount(0);
    await expect(page.getByTestId("composer-file-attachment-pill")).toContainText(TEST_JSON.name);
    await expectComposerEditable(page);
  });

  test("compact Plus menu aligns attachment rows with its sheet title", async ({
    page,
    withWorkspace,
  }) => {
    test.setTimeout(60_000);
    const workspace = await withWorkspace({ prefix: "attach-sheet-rails-" });
    await workspace.navigateTo();
    await clickNewChat(page);
    await expectComposerVisible(page);
    await page.setViewportSize({ width: 390, height: 844 });

    await openAttachmentMenu(page);

    await expectAttachmentSheetRowsOnTitleRail(page);
  });

  test("GitHub combobox does not render until the picker is opened", async ({
    page,
    withWorkspace,
  }) => {
    test.setTimeout(60_000);
    const workspace = await withWorkspace({ prefix: "attach-gh-lazy-" });
    await workspace.navigateTo();
    await clickNewChat(page);
    await expectComposerVisible(page);

    await expect(page.getByTestId("combobox-desktop-container")).not.toBeVisible();

    await openGithubPickerFromMenu(page);

    await expect(page.getByPlaceholder("Search issues and PRs...")).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByTestId("combobox-empty-text").or(page.getByText("Searching...")),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("attaches an issue and a pull request from the repository picker", async ({ page }) => {
    test.setTimeout(120_000);
    if (!hasGithubAuth()) {
      test.skip(true, "GitHub auth not available in this environment");
    }
    const ghRepo = await createTempGithubRepo({
      category: "attachments",
      issues: [{ title: "fix: attachment issue" }],
      prs: [{ title: "feat: attachment pull request", state: "open" }],
    });
    const handle = await openGithubWorkspace(page, ghRepo.prs[0].localPath);
    try {
      await clickNewChat(page);
      await expectComposerVisible(page);
      // Choose from the repository list. Newly created repositories are not
      // necessarily available in GitHub's separate text-search index yet.
      await selectGithubOption(page, "", `issue:${ghRepo.issues[0].number}`);
      await expectGithubAttachmentPill(page, ghRepo.issues[0]);
      await selectGithubOption(page, "", `change_request:${ghRepo.prs[0].number}`);
      await expectGithubAttachmentPill(page, ghRepo.prs[0]);
      await expectGithubAttachmentPill(page, ghRepo.issues[0]);
    } finally {
      await handle.cleanup();
      await ghRepo.cleanup();
    }
  });

  test.fixme("workspace-review pill suppresses on X-click and reappears after send", async () => {
    // The review attachment is created via InlineReviewEditor in surface.tsx (addComment action).
    // Automating this requires: a workspace with staged changes, navigating to the diff panel,
    // hovering the gutter "+" button, typing a comment, and submitting. A dedicated
    // helpers/review.ts with addInlineReviewComment(page, filePath, lineNumber, comment) is
    // needed before this can be exercised end-to-end.
  });

  test("attaches, previews, and removes an image before dropping a file", async ({
    page,
    withWorkspace,
  }) => {
    test.setTimeout(60_000);
    const workspace = await withWorkspace({ prefix: "attach-lightbox-" });
    await workspace.navigateTo();
    await clickNewChat(page);
    await expectComposerVisible(page);

    await test.step("open the available attachment choices", async () => {
      await openAttachmentMenu(page);
      await expect(page.getByTestId("message-input-attachment-menu-item-image")).toBeVisible();
      await expect(page.getByTestId("message-input-attachment-menu-item-github")).toBeVisible();
      await page.keyboard.press("Escape");
    });

    await attachImageFromMenu(page, TEST_IMAGE);
    await expectAttachmentPill(page, "composer-image-attachment-pill");

    await openImageLightbox(page);
    await closeImageLightbox(page);

    await test.step("remove the image and attach a dropped file", async () => {
      await removeAttachmentPill(page, "composer-image-attachment-pill", "Remove image attachment");
      await expect(page.getByTestId("composer-image-attachment-pill")).toHaveCount(0);
      await dropFileOnComposer(page, TEST_JSON);
      await expectAttachmentPill(page, "composer-file-attachment-pill");
    });
  });

  test("dropped JSON file renders as a file attachment in New Workspace", async ({ page }) => {
    test.setTimeout(120_000);
    const workspace = await seedWorkspace({ repoPrefix: "attach-drop-new-workspace-" });

    try {
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await switchWorkspaceViaSidebar({
        page,
        serverId: getServerId(),
        workspaceId: workspace.workspaceId,
      });

      await openNewWorkspaceComposer(page, {
        projectKey: workspace.projectKey,
        projectDisplayName: workspace.projectDisplayName,
      });

      await dropFileOnComposer(page, TEST_JSON);

      await expectAttachmentPill(page, "composer-file-attachment-pill");
    } finally {
      await workspace.cleanup();
    }
  });

  test("submitting while agent is running queues the message and clears the draft", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const agent = await startRunningMockAgent(page, {
      prefix: "attach-queue-",
      model: "one-minute-stream",
      prompt: "Stay running for queue test.",
    });
    try {
      await fillComposerDraft(page, "queued draft text");
      await sendDraftToQueue(page);

      await expectQueuedMessageButton(page);
      await expectComposerDraft(page, "");
    } finally {
      await agent.cleanup();
    }
  });

  test("Escape interrupt cancels the running agent and preserves composer draft", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const agent = await startRunningMockAgent(page, {
      prefix: "attach-interrupt-",
      model: "ten-second-stream",
      prompt: "Stay running for interrupt test.",
    });
    try {
      await fillComposerDraft(page, "preserve me");
      await pressInterruptShortcut(page);

      await expectAgentIdle(page, 15_000);
      await expectComposerDraft(page, "preserve me");
    } finally {
      await agent.cleanup();
    }
  });

  test("Escape cancels file creation without interrupting the running agent", async ({ page }) => {
    test.setTimeout(120_000);
    const agent = await startRunningMockAgent(page, {
      prefix: "file-create-escape-",
      model: "one-minute-stream",
      prompt: "Stay running while a file draft is cancelled.",
    });
    try {
      await openFileExplorer(page);
      await page.getByTestId("files-new-file").click();
      const nameInput = page.getByTestId("file-explorer-name-input");
      await expect(nameInput).toBeVisible();

      await nameInput.press("Escape");

      await expect(nameInput).toBeHidden();
      await expect(page.getByRole("button", { name: /stop|cancel/i }).first()).toBeVisible();
    } finally {
      await agent.cleanup();
    }
  });

  test("composer is locked while new workspace agent is being created", async ({ page }) => {
    test.setTimeout(120_000);
    const serverId = getServerId();

    const agentCreatedDelay = await delayBrowserAgentCreatedStatus(page);
    const workspace = await seedWorkspace({ repoPrefix: "attach-lock-" });

    try {
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await switchWorkspaceViaSidebar({
        page,
        serverId,
        workspaceId: workspace.workspaceId,
      });

      await openNewWorkspaceComposer(page, {
        projectKey: workspace.projectKey,
        projectDisplayName: workspace.projectDisplayName,
      });
      await fillComposerDraft(page, "lock test prompt");
      const createButton = page
        .getByTestId("message-input-root")
        .getByRole("button", { name: "Create" });
      await expect(createButton).toBeVisible({ timeout: 30_000 });
      await createButton.click();

      await agentCreatedDelay.waitForCreateRequest();
      await agentCreatedDelay.waitForDelayedCreatedStatus();

      await expectComposerDisabled(page);
      await expectAttachButtonDisabled(page);

      agentCreatedDelay.release();

      await expectComposerEditable(page);
    } finally {
      agentCreatedDelay.release();
      await workspace.cleanup();
    }
  });
});

test("sticky user message preserves uploaded image and file attachments", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const agent = await seedLongMockAgentTimeline({ turns: 20 });
  try {
    await openAgentTimeline(page, agent);
    const sticky = page.getByTestId("sticky-user-message");
    await chatOutlineRail(page).getByRole("tab").first().click();
    await expectTimelinePromptLandedBelowTop(page, agent.oldestPrompt);
    await scrollTimelinePastPrompt(page, agent.oldestPrompt);
    await attachImageFromMenu(page, TEST_IMAGE);
    await attachFileFromMenu(page, TEST_JSON);
    await expectAttachmentPill(page, "composer-file-attachment-pill");
    const prompt = "Attached sample.";
    await submitMessageWithButton(page, prompt);
    const timeline = page.getByTestId("agent-chat-scroll");
    const original = timeline.getByTestId("user-message").filter({ hasText: prompt });
    // Image encoding precedes sending: an optimistic row or the previous idle state is not acceptance.
    await expect(original).toHaveAttribute("aria-busy", "false");
    const attachmentEntry = chatOutlineRail(page).getByRole("tab", { name: /Attached sample\./ });
    const attachmentSequence = await outlinePromptSequence(attachmentEntry);
    await agent.client.waitForFinish(agent.agentId, 15_000);
    await agent.client.sendAgentMessage(
      agent.agentId,
      "emit 85 assistant messages before synthetic user message",
    );
    await agent.client.waitForFinish(agent.agentId, 15_000);
    // Select the intended attachment prompt explicitly; synthetic stream fixtures can
    // insert additional user rows, so a previous arrow does not identify this target.
    const paddingEntries = chatOutlineRail(page).getByRole("tab", {
      name: /emit 85 assistant messages before synthetic user message/,
    });
    await expect(paddingEntries).toHaveCount(1);
    expect(attachmentSequence).toBeLessThan(await outlinePromptSequence(paddingEntries));
    await attachmentEntry.click();
    await expectTimelinePromptLandedBelowTop(page, prompt);
    const originalBody = (await original.getByTestId("user-message-bubble").boundingBox())!;
    const viewportBox = (await timeline.boundingBox())!;
    await timeline.hover();
    await page.mouse.wheel(0, originalBody.y - viewportBox.y + 1);
    await expect(sticky).toContainText("2 attachments");
    const originalText = original.getByTestId("user-message-text");
    await expect(originalText).toBeInViewport();
    await expect(original.getByTestId("user-message-prefix-mask")).toBeVisible();
    // The full attachment layout places its text below the compact copy. Verify
    // those source glyphs are actually covered instead of painting a second Files.
    const originalTextBounds = (await originalText.boundingBox())!;
    const stickyBounds = (await sticky.boundingBox())!;
    const visibleTextTop = Math.max(originalTextBounds.y, stickyBounds.y + stickyBounds.height + 1);
    const visibleTextHeight = originalTextBounds.y + originalTextBounds.height - visibleTextTop;
    expect(visibleTextHeight).toBeGreaterThan(0);
    const paintedText = await page.screenshot({
      clip: {
        x: originalTextBounds.x,
        y: visibleTextTop,
        width: originalTextBounds.width,
        height: visibleTextHeight,
      },
      path: "../../docs/qa-evidence/sticky-user-message/attachment-covered-text.png",
    });
    const uniformBackground = await page.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, image.width, image.height).data;
      return pixels.every((channel, index) => channel === pixels[index % 4]);
    }, paintedText.toString("base64"));
    expect(uniformBackground).toBe(true);
    await page.screenshot({
      path: "../../docs/qa-evidence/sticky-user-message/attachment-single-copy.png",
    });
    await scrollTimelinePastPrompt(page, prompt);
    await expect(sticky).toContainText("2 attachments");
    await expectInlineStickyAttachmentCount(sticky, "2 attachments", prompt, testInfo);
    const attachmentTextGeometry = await expectSingleLineStickyGeometry(sticky);
    await sticky.getByRole("button", { name: "Expand user message", exact: true }).click();
    await expect(sticky.getByTestId("user-message")).toContainText(prompt);
    await expect(sticky).toContainText(TEST_JSON.name);
    await expect(
      sticky.getByRole("button", { name: "Open image attachment", exact: true }),
    ).toBeVisible();
    await sticky.getByRole("button", { name: "Collapse user message", exact: true }).click();
    await expect(sticky).toContainText("2 attachments");
    expect((await expectSingleLineStickyGeometry(sticky)).height).toBeCloseTo(
      attachmentTextGeometry.height,
      0,
    );

    // Reuse real uploads for an attachment-only prompt, without inventing placeholder text.
    await attachImageFromMenu(page, TEST_IMAGE);
    await attachFileFromMenu(page, TEST_JSON);
    await submitMessageWithButton(page, "");
    const attachmentOnlyOriginal = timeline
      .getByTestId("user-message")
      .filter({ hasText: TEST_JSON.name })
      .filter({ hasNot: page.getByTestId("user-message-text") });
    await expect(attachmentOnlyOriginal).toHaveAttribute("aria-busy", "false");
    const attachmentOnlyEntry = chatOutlineRail(page).getByRole("tab", {
      name: /^\d+ of \d+:\s*$/,
    });
    const attachmentOnlySequence = await outlinePromptSequence(attachmentOnlyEntry);
    await agent.client.waitForFinish(agent.agentId, 15_000);
    await agent.client.sendAgentMessage(
      agent.agentId,
      "emit 85 assistant messages before synthetic user message",
    );
    await agent.client.waitForFinish(agent.agentId, 15_000);
    // This fixture has one empty-preview prompt. Synthetic user events can change
    // its order, so retain its canonical sequence tick instead of an earlier count.
    await expect(paddingEntries).toHaveCount(2);
    expect(attachmentOnlySequence).toBeLessThan(await outlinePromptSequence(paddingEntries.last()));
    await expect(attachmentOnlyEntry).toHaveCount(1);
    const attachmentOnlyTickId = await attachmentOnlyEntry.getAttribute("data-testid");
    expect(attachmentOnlyTickId).toMatch(/^chat-outline-tick-\d+$/);
    const attachmentOnlyTick = chatOutlineRail(page).getByTestId(attachmentOnlyTickId!);
    await attachmentOnlyTick.click();
    await expect(attachmentOnlyOriginal).toHaveCount(1);

    // Sample one mounted occurrence and its viewport together after hover, while
    // the existing navigation owner settles the requested original at its 8px inset.
    const readAttachmentOnlyLanding = () =>
      attachmentOnlyOriginal.getByTestId("user-message-bubble").evaluate((bubble) => {
        const viewport = bubble.closest<HTMLElement>('[data-testid="agent-chat-scroll"]')!;
        const originalBounds = bubble.getBoundingClientRect();
        const viewportBounds = viewport.getBoundingClientRect();
        return {
          messageId: bubble.closest("[data-message-id]")?.getAttribute("data-message-id"),
          originalBounds: originalBounds.toJSON(),
          viewportBounds: viewportBounds.toJSON(),
          relativeTop: originalBounds.top - viewportBounds.top,
          scrollTop: viewport.scrollTop,
          scrollHeight: viewport.scrollHeight,
          clientHeight: viewport.clientHeight,
        };
      });
    await timeline.hover();
    let previousLanding: Awaited<ReturnType<typeof readAttachmentOnlyLanding>> | undefined;
    await expect
      .poll(async () => {
        const current = await readAttachmentOnlyLanding();
        const stable =
          previousLanding !== undefined &&
          previousLanding.messageId === current.messageId &&
          previousLanding.scrollTop === current.scrollTop &&
          previousLanding.scrollHeight === current.scrollHeight &&
          previousLanding.relativeTop === current.relativeTop;
        previousLanding = current;
        return stable ? Math.abs(current.relativeTop - 8) : Number.POSITIVE_INFINITY;
      })
      .toBeLessThanOrEqual(2);
    await expect(attachmentOnlyTick).toHaveAttribute("aria-selected", "true");
    const attachmentOnlyLanding = await readAttachmentOnlyLanding();
    expect(Math.abs(attachmentOnlyLanding.relativeTop - 8)).toBeLessThanOrEqual(2);
    expect(attachmentOnlyLanding.messageId).toBeTruthy();
    await testInfo.attach("attachment-only-before-wheel", {
      body: JSON.stringify({ tickId: attachmentOnlyTickId, ...attachmentOnlyLanding }, null, 2),
      contentType: "application/json",
    });
    await page.mouse.wheel(0, attachmentOnlyLanding.relativeTop + 1);
    await expect(sticky).toContainText("2 attachments");
    await expect(sticky.getByTestId("user-message-text")).toHaveCount(0);
    await expectInlineStickyAttachmentCount(sticky, "2 attachments", "", testInfo);
    const attachmentOnlyBubble = sticky.getByTestId("user-message-bubble");
    await expect
      .poll(async () => (await attachmentOnlyBubble.boundingBox())!.height)
      .toBeCloseTo(attachmentTextGeometry.height, 0);
    await sticky.getByRole("button", { name: "Expand user message", exact: true }).click();
    await expect(sticky).toContainText(TEST_JSON.name);
    await expect(
      sticky.getByRole("button", { name: "Open image attachment", exact: true }),
    ).toBeVisible();
    await sticky.getByRole("button", { name: "Collapse user message", exact: true }).click();
    await expect
      .poll(async () => (await attachmentOnlyBubble.boundingBox())!.height)
      .toBeCloseTo(attachmentTextGeometry.height, 0);
  } catch (error) {
    // Capture the still-owned conversation before agent cleanup can remove its route.
    try {
      const geometry = await page.evaluate(() => {
        const sticky = document.querySelector('[data-testid="sticky-user-message"]');
        const selectors = [
          '[data-testid="user-message-bubble"]',
          '[data-testid="user-message-text"]',
          '[data-testid="sticky-user-message-controls"]',
          '[data-testid="sticky-user-message-disclosure"]',
          "[data-message-text=true]",
        ];
        return {
          url: location.href,
          viewport: { width: innerWidth, height: innerHeight },
          nodes: selectors.map((selector) => {
            const node = sticky?.querySelector(selector);
            if (!node) return { selector, present: false };
            const style = getComputedStyle(node);
            return {
              selector,
              present: true,
              bounds: node.getBoundingClientRect().toJSON(),
              parentBounds: node.parentElement?.getBoundingClientRect().toJSON(),
              lineHeight: style.lineHeight,
              paddingTop: style.paddingTop,
              paddingBottom: style.paddingBottom,
              opacity: style.opacity,
              pointerEvents: style.pointerEvents,
            };
          }),
        };
      });
      await testInfo.attach("attachments-failure-geometry", {
        body: JSON.stringify(geometry, null, 2),
        contentType: "application/json",
      });
    } catch (captureError) {
      console.error("attachments geometry capture failed before cleanup", String(captureError));
    }
    try {
      await page.screenshot({
        path: testInfo.outputPath("attachments-before-cleanup.png"),
        timeout: 2_000,
      });
    } catch (captureError) {
      console.error("attachments screenshot capture failed before cleanup", String(captureError));
    }
    throw error;
  } finally {
    await agent.cleanup();
  }
});
