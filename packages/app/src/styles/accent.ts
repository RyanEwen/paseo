import { z } from "zod";
import type { Theme } from "./theme";

export const ACCENT_OPTIONS = [
  "default",
  "blue",
  "green",
  "purple",
  "rose",
  "orange",
  "teal",
] as const;
export const AccentColorSchema = z.enum(ACCENT_OPTIONS);
export type AccentColor = z.infer<typeof AccentColorSchema>;

interface AccentPair {
  light: string;
  dark: string;
}

// Dark fills use pale colors with dark text; light fills use deep colors with white text.
// Keep semantic status and identity palettes independent of this personal preference.
export const ACCENT_PALETTE: Record<Exclude<AccentColor, "default">, AccentPair> = {
  blue: { light: "#1d4ed8", dark: "#93c5fd" },
  green: { light: "#166534", dark: "#86efac" },
  purple: { light: "#7e22ce", dark: "#d8b4fe" },
  rose: { light: "#be123c", dark: "#fda4af" },
  orange: { light: "#9a3412", dark: "#fdba74" },
  teal: { light: "#115e59", dark: "#5eead4" },
};

/** Resolve from an authored theme so Default restores its original accent and message colors. */
export function resolveAccentColors(base: Theme, choice: AccentColor) {
  if (choice === "default") {
    return {
      accent: base.colors.accent,
      accentBright: base.colors.accentBright,
      accentForeground: base.colors.accentForeground,
      userMessageBackground: base.colors.surface3,
      userMessageForeground: base.colors.foreground,
      userMessageMutedForeground: base.colors.foregroundMuted,
    };
  }

  const accent = ACCENT_PALETTE[choice][base.colorScheme];
  const foreground = base.colorScheme === "light" ? "#ffffff" : "#18181b";
  return {
    accent,
    accentBright: accent,
    accentForeground: foreground,
    userMessageBackground: accent,
    userMessageForeground: foreground,
    userMessageMutedForeground: foreground,
  };
}
