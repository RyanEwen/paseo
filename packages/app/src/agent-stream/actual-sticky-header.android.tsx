import type { ReactNode } from "react";
import { useComposerViewportRef } from "@/composer/dock/internal/viewport-ref";
import { NativeMeasurementContext } from "./native-sticky-viewport";
import { resolveNativeMotionOwner } from "./native-actual-row-model";
import { ActualPromptRowsContext } from "./actual-prompt-rows";
import { createNativeStickyLayout } from "./native-sticky-layout";
import { NativeStickyLayoutContext } from "./native-sticky-layout-context";
import {
  cloneElement,
  useCallback,
  useContext,
  useMemo,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Animated as RNAnimated, View, type LayoutChangeEvent } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import RNStickyHeader from "react-native/Libraries/Components/ScrollView/ScrollViewStickyHeader";
import {
  KeyboardDockDisplacementContext,
  useKeyboardDockDisplacement,
} from "@/keyboard/shift/internal/dock-displacement.android";
import { useNativeStickyViewport } from "./native-sticky-viewport";
import { nativeStickyTranslation } from "./native-actual-row-model";
import type { NativeStickyHandle, NativeStickyProps } from "./native-sticky-contract";

/** Keep RN's outer t0/Fabric passthrough unmodified. Only the inner delta is
 * Reanimated. Layout and next-header collision values form one UI snapshot. */
export function ActualStickyHeader({ ref, children, ...props }: NativeStickyProps) {
  const reportLayout = props.onLayout;
  const enabled = useContext(ActualPromptRowsContext) !== null;
  const zero = useMemo(() => new RNAnimated.Value(0), []);
  const channel = useMemo(
    () =>
      createNativeStickyLayout<LayoutChangeEvent>({
        key: children.key,
        index: children.props.index,
      }),
    [children.key, children.props.index],
  );
  const inner = useRef<NativeStickyHandle>(null);
  const { y } = useNativeStickyViewport();
  const k = useKeyboardDockDisplacement();
  const [layout, setLayout] = useState<{ y: number; height: number } | null>(null);
  const next = useRef<number | null>(props.nextHeaderLayoutY ?? null);
  const lastPropNext = useRef(props.nextHeaderLayoutY);
  const geometry = useSharedValue({ ready: false, y: 0, height: 0, next: next.current });
  useLayoutEffect(() => {
    if (lastPropNext.current !== props.nextHeaderLayoutY) {
      lastPropNext.current = props.nextHeaderLayoutY;
      next.current = props.nextHeaderLayoutY ?? null;
    }
    geometry.value = {
      ready: layout !== null,
      y: layout?.y ?? 0,
      height: layout?.height ?? 0,
      next: next.current,
    };
  }, [props.nextHeaderLayoutY, layout, geometry]);
  useImperativeHandle(
    ref,
    () => ({
      setNextHeaderY(value) {
        next.current = value;
        geometry.value = { ...geometry.value, next: value };
        inner.current?.setNextHeaderY(value);
      },
    }),
    [geometry],
  );
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      setLayout(event.nativeEvent.layout);
      reportLayout(event);
      event.persist();
      channel.publish(event);
    },
    [reportLayout, channel],
  );
  const originalLayout = children.props.onLayout;
  const onChildLayout = useCallback(
    (event: LayoutChangeEvent) => originalLayout?.(event),
    [originalLayout],
  );
  const style = useAnimatedStyle(() => {
    const g = geometry.value;
    const delta =
      !enabled || !g.ready
        ? 0
        : nativeStickyTranslation(y.value + k.value, g.y, g.height, g.next) -
          nativeStickyTranslation(y.value, g.y, g.height, g.next);
    return { transform: [{ translateY: delta }], overflow: "visible" };
  });
  return (
    <RNStickyHeader
      {...props}
      scrollAnimatedValue={enabled ? props.scrollAnimatedValue : zero}
      ref={inner}
      onLayout={onLayout}
    >
      <View
        style={[children.props.style, { overflow: "visible" }]}
        onLayout={onChildLayout}
        collapsable={false}
      >
        <Animated.View style={style} collapsable={false}>
          <NativeStickyLayoutContext.Provider value={channel}>
            {cloneElement(children, { onLayout: undefined })}
          </NativeStickyLayoutContext.Provider>
        </Animated.View>
      </View>
    </RNStickyHeader>
  );
}

/** Read-only provider-child panes are explicitly unshifted; a partial dock
 * contract still fails rather than silently dropping its physical motion. */
export function NativeActualMotionBoundary({
  allowStandalone,
  children,
}: {
  allowStandalone: boolean;
  children: ReactNode;
}) {
  const inherited = useContext(KeyboardDockDisplacementContext);
  const stationaryViewportRef = useComposerViewportRef();
  const zero = useSharedValue(0);
  const mode = resolveNativeMotionOwner(
    allowStandalone,
    inherited !== null,
    stationaryViewportRef !== null,
  );
  const value = useMemo(() => ({ mode, stationaryViewportRef }), [mode, stationaryViewportRef]);
  return (
    <KeyboardDockDisplacementContext.Provider value={inherited ?? zero}>
      <NativeMeasurementContext.Provider value={value}>
        {children}
      </NativeMeasurementContext.Provider>
    </KeyboardDockDisplacementContext.Provider>
  );
}
