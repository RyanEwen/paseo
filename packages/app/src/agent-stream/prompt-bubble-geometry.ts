import { createContext, type ComponentRef } from "react";
import type { View } from "react-native";

export type PromptBubbleNode = ComponentRef<typeof View>;

/** The timeline owner measures original bubbles only. Sticky copies never register here. */
export const PromptBubbleGeometryContext = createContext<{
  register(id: string, node: PromptBubbleNode | null): void;
  onLayout(): void;
  onTextLayout(id: string, lines: readonly { y: number; height: number }[]): void;
} | null>(null);

/** Complementary painting keeps an original's tail while suppressing only text already
 * copied at the top. Expansion owns the whole message; row layout is retained in both modes.
 */
export const PromptPixelOwnerContext = createContext<{
  id: string;
  prefixHeight: number;
  expanded: boolean;
} | null>(null);
