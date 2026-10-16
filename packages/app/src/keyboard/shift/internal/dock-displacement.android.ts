import { createContext, useContext } from "react";
import type { SharedValue } from "react-native-reanimated";

/** Same shared value drives both the dock transform and its effective visible edge. */
export const KeyboardDockDisplacementContext = createContext<SharedValue<number> | null>(null);

export function useKeyboardDockDisplacement() {
  const displacement = useContext(KeyboardDockDisplacementContext);
  if (!displacement) throw new Error("The sticky viewport must be inside KeyboardTranslateView");
  return displacement;
}
