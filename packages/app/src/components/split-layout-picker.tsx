import { useCallback, useMemo } from "react";
import { View, Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { SPLIT_LAYOUT_PRESETS, type SplitSide } from "./split-layout-presets";
import { SplitPresetGlyph } from "./split-layout-glyph";

const SIDES: SplitSide[] = ["left", "right", "top", "bottom"];
interface SplitLayoutPickerProps {
  onSelect: (side: SplitSide, fraction: number) => void;
  disabled?: boolean;
  testIDPrefix: string;
}

/** Explicit side and proportion choices; the highlighted diagram region is the new pane. */
export function SplitLayoutPicker({
  onSelect,
  disabled = false,
  testIDPrefix,
}: SplitLayoutPickerProps) {
  const { t } = useTranslation();
  return (
    <View style={styles.grid}>
      {SIDES.map((side) => (
        <View key={side} style={styles.section}>
          <Text style={styles.label}>{t(`workspace.splits.${side}`)}</Text>
          <SplitLayoutRatioRow
            side={side}
            onSelect={onSelect}
            disabled={disabled}
            testIDPrefix={testIDPrefix}
          />
        </View>
      ))}
    </View>
  );
}

/** A single orientation row for a divider or a tab’s side submenu. */
export function SplitLayoutRatioRow({
  side,
  onSelect,
  disabled = false,
  testIDPrefix,
}: { side: SplitSide } & SplitLayoutPickerProps) {
  return (
    <View style={styles.row}>
      {SPLIT_LAYOUT_PRESETS.map((preset) => (
        <SplitChoice
          key={preset.label}
          side={side}
          fraction={preset.fraction}
          label={preset.label}
          onSelect={onSelect}
          disabled={disabled}
          testIDPrefix={testIDPrefix}
        />
      ))}
    </View>
  );
}

function SplitChoice({
  side,
  fraction,
  label,
  onSelect,
  disabled,
  testIDPrefix,
}: { side: SplitSide; fraction: number; label: string } & SplitLayoutPickerProps) {
  const { t } = useTranslation();
  const select = useCallback(() => onSelect(side, fraction), [side, fraction, onSelect]);
  const icon = useMemo(
    () => <SplitPresetGlyph side={side} fraction={fraction} />,
    [side, fraction],
  );
  const dataSet = useMemo(
    () => ({ menuItem: "true", menuDisabled: disabled ? "true" : "false" }),
    [disabled],
  );
  return (
    <Button
      variant="ghost"
      size="md"
      style={styles.choice}
      textStyle={styles.ratio}
      leftIcon={icon}
      disabled={disabled}
      onPress={select}
      testID={`${testIDPrefix}-${side}-${label.replace("/", "-")}`}
      accessibilityRole="menuitem"
      accessibilityLabel={`${t(`workspace.splits.${side}`)} ${label}`}
      dataSet={dataSet}
      tabIndex={-1}
    >
      {label}
    </Button>
  );
}

const styles = StyleSheet.create((theme) => ({
  grid: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    gap: theme.spacing[2],
  },
  section: { gap: theme.spacing[1] },
  label: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    paddingHorizontal: theme.spacing[1],
  },
  row: { flexDirection: "row", gap: theme.spacing[1] },
  choice: {
    width: 52,
    minHeight: 58,
    flexDirection: "column",
    gap: theme.spacing[0.5],
    paddingHorizontal: theme.spacing[0.5],
  },
  ratio: { fontSize: theme.fontSize.sm },
}));
