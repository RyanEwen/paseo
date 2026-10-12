import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
} from "react-native-reanimated";
import { SPACING } from "@/styles/theme";

const TIMING = {
  duration: 180,
  easing: Easing.inOut(Easing.ease),
  reduceMotion: ReduceMotion.System,
};

interface HoverRevealActionsProps {
  visible: boolean;
  /** Full action width, including any optical offset already applied to the controls. */
  width: number;
  height: number;
  children: ReactNode;
}

/** Animate the reserved action space inside a fixed row so adjacent metadata slides aside. */
export function HoverRevealActions({ visible, width, height, children }: HoverRevealActionsProps) {
  const progress = useDerivedValue(() => withTiming(visible ? 1 : 0, TIMING));
  const animatedStyle = useAnimatedStyle(() => ({
    width: width * progress.value,
    opacity: progress.value,
    // Cancel the row's inter-item gap while the actions occupy no space.
    marginLeft: -SPACING[2] * (1 - progress.value),
  }));
  return (
    <Animated.View
      style={[styles.slot, { height }, animatedStyle]}
      pointerEvents={visible ? "auto" : "none"}
    >
      <View style={[styles.actions, { width, height }]}>{children}</View>
    </Animated.View>
  );
}

// Animated nodes use static styles so Unistyles and Reanimated never patch the same native node.
const styles = StyleSheet.create({
  slot: { flexShrink: 0 },
  actions: { position: "absolute", top: 0, right: 0 },
});
