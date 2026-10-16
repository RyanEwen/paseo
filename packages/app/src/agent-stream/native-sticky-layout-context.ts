import { createContext } from "react";
import type { LayoutChangeEvent } from "react-native";
import type { createNativeStickyLayout } from "./native-sticky-layout";
export const NativeStickyLayoutContext = createContext<ReturnType<
  typeof createNativeStickyLayout<LayoutChangeEvent>
> | null>(null);
