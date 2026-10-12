import { useCallback, useEffect, useRef, useState } from "react";
import { Text, type LayoutChangeEvent, type TextLayoutEvent } from "react-native";
import { isWeb } from "@/constants/platform";

/** Measure rendered text overflow. Existing single-line callers need only the visible ref.
 * Clamped previews also mount an identical, unbounded Text at the same width and attach
 * fullRef/onFullTextLayout. Native compares actual laid-out lines; web compares measured
 * full/clamped extents. Hidden retained surfaces preserve their last positive measurement.
 */
export function useTextOverflow(text: string, numberOfLines = 1) {
  const ref = useRef<Text>(null);
  const fullRef = useRef<Text>(null);
  const width = useRef(0);
  const height = useRef(0);
  const fullLineCount = useRef<number | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  const measure = useCallback(() => {
    if (!isWeb) {
      if (width.current > 0 && height.current > 0 && fullLineCount.current !== null) {
        setOverflowing(fullLineCount.current > numberOfLines);
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
  }, [numberOfLines]);
  useEffect(() => {
    if (!isWeb || !ref.current) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(ref.current as unknown as HTMLElement);
    if (fullRef.current) observer.observe(fullRef.current as unknown as HTMLElement);
    return () => observer.disconnect();
  }, [measure, text]);
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
    (event: TextLayoutEvent) => {
      fullLineCount.current = event.nativeEvent.lines.length;
      measure();
    },
    [measure],
  );
  return { ref, fullRef, onLayout, onTextLayout, onFullTextLayout, overflowing };
}
