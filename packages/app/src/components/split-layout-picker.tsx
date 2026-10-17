import { useCallback, useMemo } from "react";
import { Pressable, View, Text, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useIsCompactFormFactor } from "@/constants/layout";
import { SPLIT_LAYOUT_PRESETS, type SplitSide } from "./split-layout-presets";

type SplitPickerIntent = { kind: "open"; item: string } | { kind: "move" };
interface SplitLayoutPickerProps {
  onSelect: (side: SplitSide, firstPaneFraction: number) => void;
  intent: SplitPickerIntent;
  disabled?: boolean;
  testIDPrefix: string;
}

/** Select the actual new-pane region; fractions always describe the left/top pane. */
export function SplitLayoutPicker(props: SplitLayoutPickerProps) {
  const { t } = useTranslation();
  const compact = useIsCompactFormFactor();
  return (
    <View style={styles.grid}>
      {(["horizontal", "vertical"] as const).map((direction) => (
        <View key={direction} style={styles.section}>
          <Text style={styles.label}>
            {t(direction === "horizontal" ? "workspace.splits.columns" : "workspace.splits.rows")}
          </Text>
          <View style={styles.row}>
            {SPLIT_LAYOUT_PRESETS.map((preset) => (
              <SplitDiagram
                key={preset.label}
                {...props}
                direction={direction}
                compact={compact}
                fraction={preset.fraction}
                label={preset.label}
              />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function SplitDiagram({
  direction,
  compact,
  fraction,
  label,
  ...props
}: SplitLayoutPickerProps & {
  direction: "horizontal" | "vertical";
  compact: boolean;
  fraction: number;
  label: string;
}) {
  const horizontal = direction === "horizontal";
  // Exclude the gap from hit regions: 30% of compact's 148px usable axis is
  // 44.4px; the other axis is 48px. Adjacent regions need no overlapping hitSlop.
  const width = compact && horizontal ? 150 : 48;
  let height = 28;
  if (compact) height = horizontal ? 48 : 150;
  const diagramStyle = useMemo(
    () => [
      styles.diagram,
      { width, height, flexDirection: horizontal ? ("row" as const) : ("column" as const) },
    ],
    [width, height, horizontal],
  );
  return (
    <View style={styles.choice}>
      <View style={diagramStyle}>
        <SplitRegion
          {...props}
          side={horizontal ? "left" : "top"}
          fraction={fraction}
          label={label}
          percent={Math.round(fraction * 100)}
          width={horizontal ? (width - 2) * fraction : width}
          height={horizontal ? height : (height - 2) * fraction}
        />
        <SplitRegion
          {...props}
          side={horizontal ? "right" : "bottom"}
          fraction={fraction}
          label={label}
          percent={Math.round((1 - fraction) * 100)}
          width={horizontal ? (width - 2) * (1 - fraction) : width}
          height={horizontal ? height : (height - 2) * (1 - fraction)}
        />
      </View>
      <Text style={styles.ratio}>{label}</Text>
    </View>
  );
}

function SplitRegion({
  side,
  fraction,
  percent,
  label,
  width,
  height,
  intent,
  onSelect,
  disabled = false,
  testIDPrefix,
}: SplitLayoutPickerProps & {
  side: SplitSide;
  fraction: number;
  percent: number;
  label: string;
  width: number;
  height: number;
}) {
  const { t } = useTranslation();
  // Menu callers own selectItem so closing and the iOS teardown grace run once.
  const select = useCallback(() => {
    if (!disabled) onSelect(side, fraction);
  }, [disabled, onSelect, side, fraction]);
  const dataSet = useMemo(
    () => ({ menuItem: "true", menuDisabled: disabled ? "true" : "false" }),
    [disabled],
  );
  const accessibilityState = useMemo(() => ({ disabled }), [disabled]);
  const regionStyle = useCallback(
    ({
      pressed,
      hovered = false,
      focused = false,
    }: PressableStateCallbackType & { hovered?: boolean; focused?: boolean }) => [
      styles.region,
      { width, height },
      !disabled && (pressed || hovered || focused) ? styles.highlighted : null,
      disabled ? styles.disabled : null,
    ],
    [disabled, width, height],
  );
  const sideLabel = t(`workspace.splits.${side}`);
  const accessibilityLabel =
    intent.kind === "open"
      ? t("workspace.splits.openRegion", { item: intent.item, side: sideLabel, percent })
      : t("workspace.splits.moveRegion", { side: sideLabel, percent });
  return (
    <Pressable
      style={regionStyle}
      disabled={disabled}
      onPress={select}
      accessibilityRole="menuitem"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}
      dataSet={dataSet}
      tabIndex={-1}
      testID={`${testIDPrefix}-${side}-${label.replace("/", "-")}`}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  grid: { width: 280, padding: theme.spacing[2], gap: theme.spacing[2] },
  section: { gap: theme.spacing[1] },
  label: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  row: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[1], alignItems: "flex-start" },
  choice: { alignItems: "center", gap: theme.spacing[1] },
  // Physical left/right stay literal even when the surrounding language is RTL.
  diagram: { direction: "ltr", gap: 2 },
  region: {
    flexShrink: 0,
    borderWidth: 1,
    borderRadius: 2,
    borderColor: theme.colors.foregroundMuted,
    backgroundColor: theme.colors.surface1,
  },
  highlighted: { backgroundColor: theme.colors.surface3, borderColor: theme.colors.accent },
  disabled: { opacity: theme.opacity[50] },
  ratio: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted, direction: "ltr" },
}));
