import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

/** Keep floating timestamps and navigation legible where conversation scrolls beneath them. */
export function PinnedMessageActionBackdrop() {
  return <View style={styles.actions} pointerEvents="none" />;
}

const styles = StyleSheet.create((theme) => ({
  actions: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: theme.colors.surface0,
    borderRadius: theme.borderRadius.lg,
  },
}));
