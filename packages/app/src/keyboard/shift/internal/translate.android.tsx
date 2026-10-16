import { DockReservationContext } from "./dock-reservation";
import { usePublishDockReservation } from "./use-dock-reservation";
import { KeyboardDockDisplacementContext } from "./dock-displacement.android";
import type { ReactNode } from "react";
import type { ViewProps } from "react-native";
import Animated, { useAnimatedStyle, useDerivedValue } from "react-native-reanimated";
import { useKeyboardShift } from "./context";

interface KeyboardTranslateViewProps extends ViewProps {
  children: ReactNode;
  enabled?: boolean;
  /** Space below the view's resting position that the keyboard may fill before the view moves. */
  bottomClearance?: number;
}

export function KeyboardTranslateView({
  children,
  enabled = true,
  bottomClearance = 0,
  style,
  ...props
}: KeyboardTranslateViewProps) {
  const reservation = usePublishDockReservation(enabled, bottomClearance);
  const { shift } = useKeyboardShift();
  // Share the physical driver, rather than bridging keyboard frames through JS.
  const displacement = useDerivedValue(
    () => (enabled ? Math.max(0, shift.value - bottomClearance) : 0),
    [enabled, bottomClearance],
  );
  const keyboardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -displacement.value }],
  }));

  return (
    <Animated.View style={[style, keyboardStyle]} {...props}>
      <KeyboardDockDisplacementContext.Provider value={displacement}>
        <DockReservationContext.Provider value={reservation}>
          {children}
        </DockReservationContext.Provider>
      </KeyboardDockDisplacementContext.Provider>
    </Animated.View>
  );
}
