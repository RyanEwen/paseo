import type { Animated, LayoutChangeEvent, ViewProps } from "react-native";
import type { ReactElement, Ref } from "react";
export interface NativeStickyHandle {
  setNextHeaderY(y: number): void;
}
/** Private RN 0.81.5 ScrollViewStickyHeader contract. Preserve wrapper/ref/Fabric
 * passthrough; the installed package source is part of this adapter's dependency. */
export interface NativeStickyProps {
  children: ReactElement<ViewProps & { index?: number; item?: { id: string } }>;
  nextHeaderLayoutY?: number | null;
  onLayout(event: LayoutChangeEvent): void;
  scrollAnimatedValue: Animated.Value | Animated.AnimatedAddition<number>;
  inverted?: boolean;
  scrollViewHeight?: number;
  nativeID?: string;
  hiddenOnScroll?: boolean;
  ref?: Ref<NativeStickyHandle>;
}
