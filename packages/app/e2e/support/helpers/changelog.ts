import { parseChangelog } from "../../../src/changelog/internal/parse-changelog";
import { expect, type Locator, type Page } from "@playwright/test";

const CHANGELOG_SOURCE_URL =
  "https://api.github.com/repos/RyanEwen/paseo-plus-plus/releases?per_page=100";

/**
 * Serves a changelog to the app instead of the repository's.
 *
 * The sheet renders whatever the document contains, so a fixture is how a test
 * states which authoring shapes it cares about.
 */
export async function serveChangelog(page: Page, lines: string[]): Promise<void> {
  await page.route(CHANGELOG_SOURCE_URL, (route) =>
    route.fulfill({
      json: parseChangelog(lines.join("\n")).map((entry) => ({
        tag_name: `v${entry.version}`,
        draft: false,
        published_at: `${entry.date}T12:00:00Z`,
        body: entry.sections
          .map((section) =>
            [section.title ? `### ${section.title}` : "", section.body]
              .filter(Boolean)
              .join("\n\n"),
          )
          .join("\n\n"),
      })),
    }),
  );
}

export async function openWhatsNew(page: Page): Promise<Locator> {
  await page.getByTestId("sidebar-help").click();
  await expect(page.getByTestId("sidebar-help-menu")).toBeVisible();
  await page.getByTestId("sidebar-help-changelog").click();

  const sheet = page.getByTestId("changelog-sheet");
  await expect(sheet).toBeVisible();
  return sheet;
}

export function release(sheet: Locator, version: string): Locator {
  return sheet.getByTestId(`changelog-release-${version}`);
}
