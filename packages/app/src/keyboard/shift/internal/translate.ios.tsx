import { DockReservationContext } from "./dock-reservation";
import { usePublishDockReservation } from "./use-dock-reservation";
import { KeyboardDockDisplacementContext } from "./dock-displacement.ios";
import { useMemo, type ReactNode } from "react";
import { Animated, type ViewProps } from "react-native";
import { useKeyboardAnimation } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

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
  const insets = useSafeAreaInsets();
  const { height, progress } = useKeyboardAnimation();
  const translateY = useMemo(
    () =>
      Animated.add(
        Animated.add(height, Animated.multiply(progress, insets.bottom)),
        bottomClearance,
      ).interpolate({
        inputRange: [-1, 0],
        outputRange: [-1, 0],
        extrapolateLeft: "extend",
        extrapolateRight: "clamp",
      }),
    [bottomClearance, height, insets.bottom, progress],
  );
  // Derive the child's visible edge from this exact native graph, including
  // safe-area/progress and bottom clearance. Do not substitute provider.shift.
  const displacement = useMemo(
    () => Animated.multiply(translateY, enabled ? -1 : 0),
    [enabled, translateY],
  );
  const keyboardStyle = useMemo(
    () => ({ transform: [{ translateY: enabled ? translateY : 0 }] }),
    [enabled, translateY],
  );

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
