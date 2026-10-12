import { expect, type Page } from "@playwright/test";
import { DEFAULT_PASEO_PLUS_PLUS_PREFERENCES } from "@/paseo-plus-plus/preferences";
import { gotoAppShell, openSettings } from "./app";
import { openMobileAgentSidebar } from "./sidebar";
import { recordSettingsExample } from "./settings-example-capture";

const EXPLORER_SETTINGS = [
  "autoOpenExplorerSidebar",
  "explorerDiffScope",
  "workingDiffDefaultComparison",
  "workingDiffAutoSwitch",
] as const;

/** Exercise real image loading, keyboard/hover or touch disclosure without changing a preference. */
export async function verifySettingsExamplesHelp(page: Page, compact: boolean, directory: string) {
  await page.setViewportSize({ width: compact ? 390 : 1440, height: compact ? 844 : 900 });
  await gotoAppShell(page);
  if (compact) await openMobileAgentSidebar(page);
  await openSettings(page);
  const features = Object.keys(DEFAULT_PASEO_PLUS_PLUS_PREFERENCES).filter(
    (feature) => feature !== "androidAutomaticUpdateChecks",
  );
  const switches = page.getByTestId("paseo-plus-plus-features").getByRole("switch");
  await expect(switches).toHaveCount(features.length);
  for (let index = 0; index < features.length; index += 1) {
    await expect(switches.nth(index)).toBeChecked();
  }
  const savedBefore = await page.evaluate(() => localStorage.getItem("@paseo:app-settings"));
  const examples = [
    ...features,
    ...EXPLORER_SETTINGS,
    "workspace-limit-mode",
    "workspace-limit-count",
  ];
  for (const example of examples) {
    const trigger = page.getByTestId(`settings-example-${example}`);
    await trigger.scrollIntoViewIfNeeded();
    await expect(trigger).toHaveAttribute("aria-label", /^About .+/);
    if (compact) {
      await trigger.tap();
    } else {
      // The existing tooltip opens keyboard focus only after actual keyboard input.
      await page.keyboard.press("Tab");
      await trigger.focus();
    }
    const content = page.getByTestId(`settings-example-${example}-content`);
    await expect(content).toBeVisible();
    const images = content.locator("img");
    const expectedCount =
      example === "sidebarWorkspaceTransitions" || EXPLORER_SETTINGS.some((key) => key === example)
        ? 2
        : 1;
    await expect(images).toHaveCount(expectedCount);
    for (const image of await images.all()) {
      await expect(image).toHaveAttribute("alt", /.+ example\./);
      await expect
        .poll(() =>
          image.evaluate(
            (element: HTMLImageElement) => element.complete && element.naturalWidth > 0,
          ),
        )
        .toBe(true);
    }
    const annotations = content.locator("svg");
    const expectedAnnotations = example.startsWith("workspace-limit-") ? 0 : expectedCount;
    await expect(annotations).toHaveCount(expectedAnnotations);
    for (const annotation of await annotations.all()) await expect(annotation).toBeVisible();
    const bounds = await content.boundingBox();
    expect(bounds).not.toBeNull();
    const viewport = page.viewportSize()!;
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
    if (
      [
        "sidebarProjectSelector",
        "sidebarWorkspaceTransitions",
        "sidebarActivityChips",
        "sidebarProjectEmphasis",
        "projectPinning",
      ].includes(example)
    ) {
      await recordSettingsExample(page, {
        id: `${compact ? "compact" : "desktop"}-help-${example}`,
        directory,
        regions: [trigger, content],
        description:
          "Actual local screenshot help after real keyboard focus or compact touch disclosure.",
      });
    }
    if (compact) {
      await page.touchscreen.tap(2, 2);
    } else {
      await page.keyboard.press("Tab");
    }
    await expect(content).toBeHidden();
    if (!compact && example === "sidebarProjectSelector") {
      await trigger.hover();
      await expect(content).toBeVisible();
      await page.mouse.move(2, 2);
      await expect(content).toBeHidden();
    }
  }
  for (let index = 0; index < features.length; index += 1) {
    await expect(switches.nth(index)).toBeChecked();
  }
  expect(await page.evaluate(() => localStorage.getItem("@paseo:app-settings"))).toBe(savedBefore);
}
