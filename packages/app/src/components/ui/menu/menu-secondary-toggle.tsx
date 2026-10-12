import { useCallback, useMemo, type ReactElement } from "react";
import {
  Pressable,
  View,
  type GestureResponderEvent,
  type PressableStateCallbackType,
} from "react-native";
import { Check } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import { useMenuContext } from "./menu-context";
import { MENU_ITEM_HEIGHT } from "./menu-geometry";

const ThemedCheck = withUnistyles(Check);
const checkboxCheckMapping = (theme: Theme) => ({ color: theme.colors.accentForeground });

/** An independent checkbox beside a menu item's primary action. It never closes the menu. */
export interface MenuItemSecondaryToggle {
  checked: boolean;
  accessibilityLabel: string;
  onSelect: () => void;
  testID?: string;
}

/** Keep primary and secondary hit targets separate; each action retains its own selection policy. */
export function MenuItemActions({
  children,
  toggle,
  disabled,
}: {
  children: ReactElement;
  toggle?: MenuItemSecondaryToggle;
  disabled: boolean;
}): ReactElement {
  if (!toggle) return children;
  return (
    <View style={styles.splitRow}>
      {children}
      <MenuSecondaryToggle toggle={toggle} disabled={disabled} />
    </View>
  );
}

/** A sibling checkbox using the same selection and keyboard-navigation engine as the primary row. */
function MenuSecondaryToggle({
  toggle,
  disabled,
}: {
  toggle: MenuItemSecondaryToggle;
  disabled: boolean;
}): ReactElement {
  const { selectItem } = useMenuContext("MenuSecondaryToggle");
  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      selectItem(toggle.onSelect, false);
    },
    [selectItem, toggle],
  );
  const accessibilityState = useMemo(
    () => ({ checked: toggle.checked, disabled }),
    [toggle.checked, disabled],
  );
  const dataSet = useMemo(
    () => ({ menuItem: "true", menuDisabled: disabled ? "true" : "false" }),
    [disabled],
  );
  const controlStyle = useMemo(
    () => [styles.toggleControl, toggle.checked && styles.toggleControlChecked],
    [toggle.checked],
  );
  const pressableStyle = useCallback(
    ({
      pressed,
      hovered = false,
      focused = false,
    }: PressableStateCallbackType & { hovered?: boolean; focused?: boolean }) => [
      styles.secondaryToggle,
      disabled && styles.disabled,
      !disabled && (hovered || pressed) && styles.hovered,
      !disabled && focused && styles.secondaryToggleFocused,
    ],
    [disabled],
  );

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={toggle.accessibilityLabel}
      accessibilityState={accessibilityState}
      aria-checked={toggle.checked}
      tabIndex={-1}
      dataSet={dataSet}
      testID={toggle.testID}
      disabled={disabled}
      onPress={handlePress}
      style={pressableStyle}
    >
      <View style={controlStyle}>
        {toggle.checked ? <ThemedCheck size={12} uniProps={checkboxCheckMapping} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  splitRow: {
    flexDirection: "row",
    alignItems: "stretch",
    marginHorizontal: theme.spacing[1],
  },
  secondaryToggle: {
    width: MENU_ITEM_HEIGHT,
    minHeight: MENU_ITEM_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: "transparent",
  },
  secondaryToggleFocused: {
    borderColor: theme.colors.borderAccent,
  },
  toggleControl: {
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.sm,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.foregroundExtraMuted,
  },
  toggleControlChecked: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  hovered: { backgroundColor: theme.colors.surface2 },
  disabled: { opacity: 0.5 },
}));
