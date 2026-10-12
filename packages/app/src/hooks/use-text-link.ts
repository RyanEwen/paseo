import { useMemo, type KeyboardEvent } from "react";
import type { GestureResponderEvent } from "react-native";
import { isWeb } from "@/constants/platform";

/** Add keyboard activation to actionable Text, whose web onPress handles clicks only.
 * Native Text retains its accessibility activation through onPress.
 */
export function useTextLink(onPress?: (event: GestureResponderEvent) => void) {
  return useMemo(
    () =>
      isWeb && onPress
        ? {
            tabIndex: 0,
            onKeyDown(event: KeyboardEvent<HTMLElement>) {
              if (event.key === "Enter") {
                event.preventDefault();
                // Both events expose currentTarget and nativeEvent to the platform guard.
                onPress(event as unknown as GestureResponderEvent);
              }
            },
          }
        : {},
    [onPress],
  );
}
