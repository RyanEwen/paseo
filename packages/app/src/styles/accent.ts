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

// Low-saturation fills keep message surfaces quiet; separate foregrounds preserve readable text.
// Keep semantic status and identity palettes independent of this personal preference.
export const ACCENT_PALETTE: Record<Exclude<AccentColor, "default">, AccentPair> = {
  blue: { light: "#3e5872", dark: "#9bafc5" },
  green: { light: "#3f604b", dark: "#a1b9a8" },
  purple: { light: "#624c71", dark: "#b4a5c2" },
  rose: { light: "#754f5a", dark: "#c0a2ab" },
  orange: { light: "#73543c", dark: "#c4ac94" },
  teal: { light: "#3b625f", dark: "#98b7b5" },
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
