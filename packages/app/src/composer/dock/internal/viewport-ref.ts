import { createContext, useContext, type RefObject } from "react";
import type { View } from "react-native";
export const ComposerViewportRef = createContext<RefObject<View | null> | null>(null);
export const useComposerViewportRef = () => useContext(ComposerViewportRef);
