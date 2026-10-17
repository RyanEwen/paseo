import { useCallback, useMemo } from "react";
import { Text, type PressableStateCallbackType } from "react-native";
import { Bell } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import { CONTROL_HEIGHTS } from "@/components/ui/control-geometry";
import { iconButtonChromeStyle } from "@/components/ui/icon-button-chrome";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useSidebarDisplayPreferences } from "./display-preferences/model";
import type { Theme } from "@/styles/theme";

const BellIcon = withUnistyles(Bell);
const outline = (theme: Theme) => ({ color: theme.colors.foregroundMuted, fill: "transparent" });
const filled = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  fill: theme.colors.foregroundMuted,
});

/** Mode is a direct action; Display remains a separate menu for the active mode. */
export function SidebarViewModeButton() {
  const { t } = useTranslation();
  const compact = useIsCompactFormFactor();
  const preferences = useSidebarDisplayPreferences();
  const mode = preferences.grouping;
  const toggle = preferences.toggleGrouping;
  const next = mode === "project" ? "status" : "project";
  const modeLabel = t("sidebar.display.modeToggle", {
    current: t(`sidebar.display.grouping.${mode}`),
    next: t(`sidebar.display.grouping.${next}`),
  });
  const label = preferences.preferencesDisabledReason
    ? `${modeLabel} ${preferences.preferencesDisabledReason}`
    : modeLabel;
  const state = useMemo(() => ({ checked: mode === "status" }), [mode]);
  const controlStyle = useCallback(
    (interaction: PressableStateCallbackType & { hovered?: boolean }) => [
      iconButtonChromeStyle({ size: "small", compact, state: interaction }),
      (isNative || compact) && styles.touchTarget,
    ],
    [compact],
  );
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger
        disabled={preferences.preferencesDisabled}
        onPress={toggle}
        style={controlStyle}
        accessibilityRole="switch"
        aria-checked={mode === "status"}
        accessibilityState={state}
        accessibilityLabel={label}
        testID="sidebar-view-mode-toggle"
      >
        <BellIcon size={compact ? 18 : 14} uniProps={mode === "status" ? filled : outline} />
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <Text style={styles.label}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}
const styles = StyleSheet.create((theme) => ({
  touchTarget: { minWidth: CONTROL_HEIGHTS.field, minHeight: CONTROL_HEIGHTS.field },
  label: { color: theme.colors.popoverForeground, fontSize: theme.fontSize.base },
}));
