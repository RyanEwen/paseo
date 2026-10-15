import { useCallback, useEffect, useRef, useState } from "react";
import { Text, type LayoutChangeEvent, type TextLayoutEvent } from "react-native";
import { isWeb } from "@/constants/platform";

/** Measure rendered text overflow. Existing single-line callers need only the visible ref.
 * Clamped previews also mount an identical, unbounded Text at the same width and attach
 * fullRef/onFullLayout. Both platforms compare actual full/clamped layout heights.
 * Hidden retained surfaces preserve their last positive measurement.
 */
export function useTextOverflow(text: string, numberOfLines = 1) {
  const ref = useRef<Text>(null);
  const fullRef = useRef<Text>(null);
  const width = useRef(0);
  const height = useRef(0);
  const fullHeight = useRef(0);
  const [overflowing, setOverflowing] = useState(false);
  const measure = useCallback(() => {
    if (!isWeb) {
      if (width.current > 0 && height.current > 0 && fullHeight.current > 0) {
        setOverflowing(fullHeight.current > height.current);
      }
      return;
    }
    if (!ref.current) return;
    const element = ref.current as unknown as HTMLElement;
    if (element.clientWidth <= 0 || element.clientHeight <= 0) return;
    const full = fullRef.current as unknown as HTMLElement | null;
    if (full) {
      if (full.clientWidth <= 0 || full.clientHeight <= 0) return;
      setOverflowing(
        full.clientHeight > element.clientHeight || full.scrollWidth > full.clientWidth,
      );
    } else {
      setOverflowing(element.scrollWidth > element.clientWidth);
    }
  }, []);
  useEffect(() => {
    if (!isWeb || !ref.current) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(ref.current as unknown as HTMLElement);
    if (fullRef.current) observer.observe(fullRef.current as unknown as HTMLElement);
    return () => observer.disconnect();
  }, [measure, numberOfLines, text]);
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      width.current = event.nativeEvent.layout.width;
      height.current = event.nativeEvent.layout.height;
      measure();
    },
    [measure],
  );
  const onTextLayout = useCallback((event: TextLayoutEvent) => {
    if (!isWeb && width.current > 0 && height.current > 0) {
      setOverflowing(event.nativeEvent.lines.some((line) => line.width > width.current));
    }
  }, []);
  const onFullTextLayout = useCallback(
    (_event: TextLayoutEvent) => {
      measure();
    },
    [measure],
  );
  const onFullLayout = useCallback(
    (event: LayoutChangeEvent) => {
      // Android's TextLayout event remeasures at rounded bounds and can report an
      // extra line for text that fits. The laid-out probe height is authoritative.
      const layout = event.nativeEvent.layout;
      fullHeight.current = layout.width > 0 ? layout.height : 0;
      measure();
    },
    [measure],
  );
  return { ref, fullRef, onLayout, onTextLayout, onFullLayout, onFullTextLayout, overflowing };
}
