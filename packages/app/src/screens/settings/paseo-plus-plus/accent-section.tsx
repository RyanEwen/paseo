import { REGISTERED_THEMES } from "@/styles/theme";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { SettingsCard, SettingsSection, SettingsRow } from "@/components/settings";
import { useSettingsSave } from "@/hooks/use-settings/use-settings-save";
import { useSettingsSyncState } from "@/settings-sync/bootstrap";
import { useSessionStore } from "@/stores/session-store";
import { selectAccentColorSupport } from "@/appearance/accent-support";
import { ACCENT_OPTIONS, type AccentColor } from "@/styles/accent";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { StyleSheet } from "react-native-unistyles";
import { resolveAccentColors } from "@/styles/accent";
import { AccentPreview } from "./accent-preview";

/** Share the standard settings save, sync, error and selected-option behavior on every platform. */
export function AccentSection() {
  const { t } = useTranslation();
  const { selectedHost } = useSettingsSyncState();
  const supported = useSessionStore((state) => selectAccentColorSupport(state, selectedHost));
  const { settings, save, pending, failed, isLoading, error } = useSettingsSave<"accentColor">();
  const select = useCallback(
    (accentColor: AccentColor) => {
      void save("accentColor", { accentColor });
    },
    [save],
  );
  const disabled = !supported || isLoading || error !== null || pending !== null;
  let hint = t("paseoPlusPlus.accent.hint");
  if (!supported) hint = t("paseoPlusPlus.accent.updateHost");
  if (pending !== null) hint = t("paseoPlusPlus.saving");
  let failure: string | undefined;
  if (error) failure = t("paseoPlusPlus.loadFailed");
  if (failed) failure = t("paseoPlusPlus.saveFailed");

  return (
    <SettingsSection title={t("paseoPlusPlus.accent.title")}>
      <SettingsCard testID="accent-color-settings">
        <SettingsRow label={t("paseoPlusPlus.accent.title")} hint={hint} error={failure} />
        <View
          style={styles.options}
          accessibilityRole="radiogroup"
          accessibilityLabel={t("paseoPlusPlus.accent.title")}
        >
          {ACCENT_OPTIONS.map((choice) => (
            <AccentOption
              key={choice}
              choice={choice}
              selected={settings.accentColor === choice}
              disabled={disabled}
              onSelect={select}
            />
          ))}
        </View>
        <AccentPreview message={t("paseoPlusPlus.accent.preview")} />
      </SettingsCard>
    </SettingsSection>
  );
}

/** Each option previews its own bubble colors before the preference is saved. */
function AccentOption({
  choice,
  selected,
  disabled,
  onSelect,
}: {
  choice: AccentColor;
  selected: boolean;
  disabled: boolean;
  onSelect: (choice: AccentColor) => void;
}) {
  const { t } = useTranslation();
  const state = useMemo(() => ({ checked: selected }), [selected]);
  const select = useCallback(() => onSelect(choice), [choice, onSelect]);
  return (
    <Button
      variant="outline"
      size="md"
      accessibilityRole="radio"
      accessibilityState={state}
      aria-checked={selected}
      accessibilityLabel={t(`paseoPlusPlus.accent.options.${choice}`)}
      testID={`accent-color-option-${choice}`}
      disabled={disabled}
      style={[styles.bubble(choice), selected ? styles.selected : styles.unselected]}
      textStyle={styles.bubbleText(choice)}
      onPress={select}
    >
      {t(`paseoPlusPlus.accent.options.${choice}`)}
    </Button>
  );
}

// Resolve each choice independently: previewing an option never writes or changes the current theme.
const styles = StyleSheet.create((theme, runtime) => {
  // Web theme strings may be CSS variables. Use the registered theme’s real discriminant
  // for palette indexing, while Default keeps the active theme’s (including plugins) tokens.
  const paletteBase =
    REGISTERED_THEMES[runtime.themeName ?? (runtime.colorScheme === "dark" ? "dark" : "light")];
  return {
    options: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: theme.spacing[2],
      paddingHorizontal: theme.spacing[4],
      paddingBottom: theme.spacing[4],
    },
    bubble: (choice: AccentColor) => ({
      backgroundColor:
        choice === "default"
          ? theme.colors.surface3
          : resolveAccentColors(paletteBase, choice).userMessageBackground,
      borderRadius: theme.borderRadius.lg,
    }),
    bubbleText: (choice: AccentColor) => ({
      color:
        choice === "default"
          ? theme.colors.foreground
          : resolveAccentColors(paletteBase, choice).userMessageForeground,
    }),
    selected: { borderWidth: 2, borderColor: theme.colors.foreground },
    unselected: { borderWidth: 2, borderColor: "transparent" },
  };
});
