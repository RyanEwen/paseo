import { useMemo, type ReactElement } from "react";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useMobilePanelsRuntime } from "./provider";

/** Give a horizontal ScrollView priority over panel-opening swipes only inside its hitbox. */
export function MobileHorizontalScrollGesture({
  children,
  enabled,
}: {
  children: ReactElement;
  enabled: boolean;
}) {
  const { leftOpenGestureRef, rightOpenGestureRef } = useMobilePanelsRuntime();
  const gesture = useMemo(
    () =>
      Gesture.Native()
        .enabled(enabled)
        .disallowInterruption(true)
        .blocksExternalGesture(leftOpenGestureRef, rightOpenGestureRef),
    [enabled, leftOpenGestureRef, rightOpenGestureRef],
  );

  return (
    <GestureDetector gesture={gesture} touchAction="pan-x">
      {children}
    </GestureDetector>
  );
}
