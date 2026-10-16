import { createContext, useContext } from "react";
import type { Animated } from "react-native";

/** Physical upward displacement from the containing KeyboardTranslateView's graph. */
export const KeyboardDockDisplacementContext = createContext<
  Animated.Value | Animated.AnimatedMultiplication<number> | null
>(null);

export function useKeyboardDockDisplacement() {
  const displacement = useContext(KeyboardDockDisplacementContext);
  if (!displacement) throw new Error("The sticky viewport must be inside KeyboardTranslateView");
  return displacement;
}
