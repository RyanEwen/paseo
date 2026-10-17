import { describe, expect, it } from "vitest";
import {
  darkPureBlackTheme,
  darkTheme,
  FONT_SIZE,
  getNextThemePreference,
  lightTheme,
  THEME_OPTIONS,
  REGISTERED_THEMES,
} from "./theme";

import { ACCENT_OPTIONS, resolveAccentColors } from "./accent";

describe("Typography scale", () => {
  it("names 14px as the default interface tier", () => {
    expect(FONT_SIZE).toEqual({
      code: 12,
      content: 15,
      sm: 12,
      base: 14,
      lg: 16,
      xl: 18,
      "2xl": 20,
      "3xl": 22,
      "4xl": 26,
    });
  });
});

describe("Theme catalog", () => {
  it("owns the picker and shortcut order", () => {
    expect(THEME_OPTIONS.map((option) => option.name)).toEqual([
      "light",
      "dark",
      "auto",
      "zinc",
      "midnight",
      "claude",
      "ghostty",
      "pureBlack",
    ]);
    expect(getNextThemePreference("dark")).toBe("auto");
    expect(getNextThemePreference("pureBlack")).toBe("light");
  });
});

describe("Pure black theme", () => {
  it("uses a pure black application and terminal background", () => {
    expect(darkPureBlackTheme.colors.surface0).toBe("#000000");
    expect(darkPureBlackTheme.colors.background).toBe("#000000");
    expect(darkPureBlackTheme.colors.terminal.background).toBe("#000000");
  });

  it("uses Paseo's muted green accent", () => {
    expect(darkPureBlackTheme.colors.accent).toBe("#20744A");
    expect(darkPureBlackTheme.colors.accentBright).toBe("#7ccba0");
  });

  it("derives sidebar interaction surfaces from the surface scale", () => {
    expect(darkPureBlackTheme.colors.surfaceSidebar).toBe("#000000");
    expect(darkPureBlackTheme.colors.surfaceSidebarHover).toBe(darkPureBlackTheme.colors.surface1);
    expect(darkPureBlackTheme.colors.surfaceSidebarSelected).toBe(
      darkPureBlackTheme.colors.surface2,
    );
  });

  it("keeps ANSI black output readable on its zero-luminance terminal background", () => {
    expect(darkPureBlackTheme.colors.terminal.black).toBe("#595959");
    expect(darkPureBlackTheme.colors.terminal.brightBlack).toBe("#8a8a8a");
  });
});

describe("Sidebar interaction surfaces", () => {
  it("keeps Light selection distinct from the sidebar surface", () => {
    expect(lightTheme.colors.surfaceSidebarHover).toBe(lightTheme.colors.surface1);
    expect(lightTheme.colors.surfaceSidebarSelected).toBe(lightTheme.colors.surface3);
    expect(lightTheme.colors.surfaceSidebarSelected).not.toBe(lightTheme.colors.surfaceSidebar);
  });

  it("derives Dark hover and selection from the first two raised surfaces", () => {
    expect(darkTheme.colors.surfaceSidebarHover).toBe(darkTheme.colors.surface1);
    expect(darkTheme.colors.surfaceSidebarSelected).toBe(darkTheme.colors.surface2);
  });
});

describe("Built-in light theme", () => {
  it("preserves its authored aliases and terminal contrast through the semantic builder", () => {
    expect(lightTheme.colors).toMatchObject({
      primary: "#18181b",
      primaryForeground: "#fafafa",
      destructiveForeground: "#ffffff",
      successForeground: "#ffffff",
      terminal: {
        black: "#1a1a1e",
        brightBlack: "#3f3f46",
      },
    });
  });
});

/** Relative sRGB luminance for the opaque authored accent palette. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

/** WCAG contrast ratio, independent of which color is brighter. */
function contrast(first: string, second: string): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Composite opaque colors for the shared Button pressed opacity. */
function blend(foreground: string, background: string, alpha: number): string {
  const channels = [1, 3, 5].map((offset) => {
    const front = Number.parseInt(foreground.slice(offset, offset + 2), 16);
    const back = Number.parseInt(background.slice(offset, offset + 2), 16);
    return Math.round(front * alpha + back * (1 - alpha))
      .toString(16)
      .padStart(2, "0");
  });
  return `#${channels.join("")}`;
}

describe("Accent colors", () => {
  it.each(Object.entries(REGISTERED_THEMES))(
    "restores authored Default colors for %s",
    (_name, base) => {
      expect(resolveAccentColors(base, "default")).toEqual({
        accent: base.colors.accent,
        accentBright: base.colors.accentBright,
        accentForeground: base.colors.accentForeground,
        userMessageBackground: base.colors.surface3,
        userMessageForeground: base.colors.foreground,
        userMessageMutedForeground: base.colors.foregroundMuted,
      });
    },
  );

  it.each(ACCENT_OPTIONS.filter((choice) => choice !== "default"))(
    "%s meets text and control contrast across authored themes",
    (choice) => {
      for (const base of Object.values(REGISTERED_THEMES)) {
        const colors = resolveAccentColors(base, choice);
        expect(contrast(colors.accent, colors.accentForeground)).toBeGreaterThanOrEqual(4.5);
        expect(
          contrast(colors.userMessageBackground, colors.userMessageForeground),
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrast(colors.userMessageBackground, colors.userMessageMutedForeground),
        ).toBeGreaterThanOrEqual(4.5);
        expect(contrast(colors.accent, base.colors.surface0)).toBeGreaterThanOrEqual(3);
        expect(contrast(colors.accent, base.colors.surface1)).toBeGreaterThanOrEqual(3);
        // The transparent ghost disclosure fades only its text over the bubble.
        const disclosurePressed = blend(
          colors.userMessageForeground,
          colors.userMessageBackground,
          0.85,
        );
        expect(contrast(disclosurePressed, colors.userMessageBackground)).toBeGreaterThanOrEqual(
          4.5,
        );
        for (const surface of [base.colors.surface0, base.colors.surface1]) {
          const pressedFill = blend(colors.accent, surface, 0.85);
          const pressedText = blend(colors.accentForeground, surface, 0.85);
          expect(contrast(pressedFill, pressedText)).toBeGreaterThanOrEqual(4.5);
        }
      }
    },
  );
});
