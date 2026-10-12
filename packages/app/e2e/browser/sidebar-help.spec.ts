import { expect, test, type Page } from "../support/fixtures";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { openSettingsSection } from "../support/helpers/settings";
import { openWhatsNew, release, serveChangelog } from "../support/helpers/changelog";

const REPOSITORY_DESTINATION = /^https:\/\/github\.com\/RyanEwen\/paseo(?:[/?#]|$)/;
const CHANGELOG_DESTINATION = /^https:\/\/github\.com\/RyanEwen\/paseo\/releases(?:[/?#]|$)/;
// The name and the version are separate cells of a key/value row, so they meet with no space
// between them in the row's text content.
const APP_VERSION = /^Paseo\s*v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

async function openHelpMenu(page: Page): Promise<void> {
  await page.getByTestId("sidebar-help").click();
  await expect(page.getByTestId("sidebar-help-menu")).toBeVisible();
}

async function expectDiagnosticReport(page: Page): Promise<void> {
  const sheet = page.getByTestId("app-diagnostic-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Copy diagnostic" })).toBeEnabled();
  await expect(page.getByText(/App version:/).first()).toBeVisible();
}

async function closeSheet(page: Page, testID: string): Promise<void> {
  const sheet = page.getByTestId(testID);
  await sheet.getByLabel("Close").click();
  await expect(sheet).not.toBeVisible();
}

async function expectExternalPage(
  page: Page,
  actionTestID: string,
  expectedUrl: RegExp,
): Promise<void> {
  const popupPromise = page.waitForEvent("popup");
  await page.locator(`[data-testid="${actionTestID}"]:visible`).click();
  const popup = await popupPromise;
  expect(popup.url()).toMatch(expectedUrl);
  await popup.close();
}

test("opens troubleshooting and support destinations", async ({ page }, testInfo) => {
  await gotoAppShell(page);
  await expect(page.getByTestId("sidebar-help")).toBeVisible();

  await test.step("opens diagnostics and keyboard shortcuts", async () => {
    await openHelpMenu(page);
    await expect(page.getByText("Help", { exact: true })).toBeVisible();
    await expect(page.getByText("Report an issue", { exact: true })).toHaveCount(0);
    await expect(page.getByText("What's new", { exact: true })).toBeVisible();
    await expect(page.getByTestId("sidebar-help-version")).toHaveText(APP_VERSION);

    await page.getByTestId("sidebar-help-diagnostics").click();
    await expectDiagnosticReport(page);
    await closeSheet(page, "app-diagnostic-sheet");

    await openHelpMenu(page);
    await page.getByTestId("sidebar-help-shortcuts").click();
    await expect(page.getByTestId("keyboard-shortcuts-dialog")).toBeVisible();
    await closeSheet(page, "keyboard-shortcuts-dialog");
  });

  await test.step("removes unavailable support and opens the fork repository", async () => {
    await openHelpMenu(page);
    await expect(page.getByTestId("sidebar-help-discord")).toHaveCount(0);
    await expect(page.getByTestId("sidebar-help-github")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("fork-help-menu.png") });
    await page.keyboard.press("Escape");
    await openSettings(page);
    await openSettingsSection(page, "about");
    await expect(page.locator('[data-testid="community-links-github-star"]:visible')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("fork-about-links.png") });
    await expect(page.getByTestId("community-links-discord")).toHaveCount(0);
    await expect(page.getByTestId("community-links-sponsor")).toHaveCount(0);
    await expectExternalPage(page, "community-links-github-star", REPOSITORY_DESTINATION);
  });
});

test("renders fork release notes and links GitHub Releases", async ({ page }) => {
  // A callout, a section name the app has never seen, and a fenced sample whose
  // contents look like a release heading.
  await serveChangelog(page, [
    "# Changelog",
    "",
    "## 9.1.0 - 2026-03-04",
    "",
    "Headline release note.",
    "",
    "> [!WARNING]",
    "> Read this before upgrading.",
    "",
    "### Sparkles",
    "",
    "- Added a brand new thing",
    "",
    "```md",
    "## 0.0.0 - 1999-01-01",
    "```",
    "",
    "## 9.0.0 - 2026-02-01",
    "",
    "### Fixed",
    "",
    "- Fixed an older thing",
    "",
  ]);
  await gotoAppShell(page);

  const sheet = await openWhatsNew(page);
  const latest = release(sheet, "9.1.0");

  await expect(latest.getByText("March 4, 2026", { exact: true })).toBeVisible();
  await expect(latest.getByText("Headline release note.")).toBeVisible();
  await expect(latest.getByText("Read this before upgrading.")).toBeVisible();
  await expect(latest.getByText("Sparkles", { exact: true })).toBeVisible();
  await expect(latest.getByText("Added a brand new thing")).toBeVisible();
  await expect(release(sheet, "9.0.0")).toBeVisible();
  await expect(release(sheet, "0.0.0")).toHaveCount(0);

  await expectExternalPage(page, "changelog-open-website", CHANGELOG_DESTINATION);
  await closeSheet(page, "changelog-sheet");
});

test("retries unavailable fork notes and excludes unpublished releases", async ({ page }) => {
  let fail = true;
  await page.route("https://api.github.com/repos/RyanEwen/paseo/releases?per_page=100", (route) => {
    if (fail) {
      return route.fulfill({ status: 403, json: { message: "API rate limit exceeded" } });
    }
    return route.fulfill({
      json: [
        {
          tag_name: "v0.11.2-preview.27",
          draft: false,
          published_at: "2026-10-09T21:26:07Z",
          body: "Published Paseo++ notes",
        },
        { tag_name: "v0.11.2-preview.28", draft: true, published_at: null, body: "Draft notes" },
      ],
    });
  });
  await gotoAppShell(page);
  const sheet = await openWhatsNew(page);
  await expect(sheet.getByTestId("changelog-error")).toBeVisible();
  fail = false;
  await sheet.getByTestId("changelog-retry").click();
  await expect(sheet.getByText("Published Paseo++ notes")).toBeVisible();
  await expect(release(sheet, "0.11.2-preview.27")).toBeVisible();
  await expect(sheet.getByText("Draft notes")).toHaveCount(0);
  await expect(sheet.getByTestId("changelog-error")).toHaveCount(0);
});

test("searches keyboard shortcuts from the sidebar help menu", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "platform", { get: () => "MacIntel" });
  });
  await gotoAppShell(page);
  await openHelpMenu(page);
  await page.getByTestId("sidebar-help-shortcuts").click();

  const dialog = page.getByTestId("keyboard-shortcuts-dialog");
  const search = page.getByPlaceholder("Search shortcuts");

  await search.fill("command+n");
  await expect(dialog.getByText("New workspace", { exact: true })).toBeVisible();

  await search.fill("interrupt");

  await expect(dialog.getByText("Interrupt agent", { exact: true })).toBeVisible();
  await expect(dialog.getByText("New workspace", { exact: true })).toHaveCount(0);

  await search.fill("no matching shortcut");
  await expect(dialog.getByText("No results found", { exact: true })).toBeVisible();

  await search.fill("");
  await expect(dialog.getByText("New workspace", { exact: true })).toBeVisible();
});

test("keeps diagnostics available from Settings after globalizing the sheet", async ({ page }) => {
  await gotoAppShell(page);
  await openSettings(page);
  await openSettingsSection(page, "diagnostics");

  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expectDiagnosticReport(page);
});

test.describe("compact sidebar help", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("footer buttons provide finger-sized targets and accept taps beyond the glyph", async ({
    page,
  }) => {
    await gotoAppShell(page);
    await openCompactSidebar(page);
    await expectFingerSizedFooterTargets(page);
    await tapHelpNearTargetEdge(page);
    await expect(page.getByTestId("sidebar-help-menu")).toBeVisible();
    await page.getByTestId("sidebar-help-diagnostics").click();
    await expectDiagnosticReport(page);
  });

  test("offers diagnostics without advertising disabled keyboard shortcuts", async ({
    page,
  }, testInfo) => {
    await gotoAppShell(page);
    await page.getByRole("button", { name: "Open menu", exact: true }).click();

    await openHelpMenu(page);
    await expect(page.getByTestId("sidebar-help-shortcuts")).toHaveCount(0);
    await expect(page.getByTestId("sidebar-help-discord")).toHaveCount(0);
    await expect(page.getByTestId("sidebar-help-github")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("fork-compact-help.png") });
    await page.getByTestId("sidebar-help-diagnostics").click();
    await expectDiagnosticReport(page);
  });
});

async function openCompactSidebar(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Open menu", exact: true }).click();
  await expect(page.getByTestId("sidebar-footer-bottom-line")).toBeVisible();
}

const MIN_TARGET_SIZE = 44;

async function expectFingerSizedFooterTargets(page: Page): Promise<void> {
  const buttons = page.getByTestId("sidebar-footer-bottom-line").getByRole("button");
  await expect(buttons).toHaveCount(5);
  for (const button of await buttons.all()) {
    const bounds = await button.boundingBox();
    // Layout can report a 44pt box as 43.99999, so compare at a hundredth of a point.
    expect(bounds?.width).toBeGreaterThanOrEqual(MIN_TARGET_SIZE - 0.01);
    expect(bounds?.height).toBeGreaterThanOrEqual(MIN_TARGET_SIZE - 0.01);
    // Glyphs stay at the composer toolbar size (some optically smaller); only the target grows.
    const glyphWidth = await button.locator("svg").first().getAttribute("width");
    expect(Number(glyphWidth)).toBeLessThanOrEqual(20);
  }
}

async function tapHelpNearTargetEdge(page: Page): Promise<void> {
  const button = page.getByRole("button", { name: "Help and support", exact: true });
  await button.tap({ position: { x: 40, y: 40 } });
}
