import { useCallback, useEffect, useRef, useState } from "react";
import { Text, type LayoutChangeEvent, type TextLayoutEvent } from "react-native";
import { isWeb } from "@/constants/platform";

/** Measures single-line text overflow and updates when its label or available width changes. */
export function useTextOverflow(text: string) {
  const ref = useRef<Text>(null);
  const width = useRef(0);
  const [overflowing, setOverflowing] = useState(false);
  const measure = useCallback(() => {
    if (!isWeb || !ref.current) return;
    const element = ref.current as unknown as HTMLElement;
    if (element.clientWidth > 0) {
      setOverflowing(element.scrollWidth > element.clientWidth);
    }
  }, []);
  useEffect(() => {
    if (!isWeb || !ref.current) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(ref.current as unknown as HTMLElement);
    return () => observer.disconnect();
  }, [measure, text]);
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      width.current = event.nativeEvent.layout.width;
      measure();
    },
    [measure],
  );
  const onTextLayout = useCallback((event: TextLayoutEvent) => {
    if (!isWeb && width.current > 0) {
      setOverflowing(event.nativeEvent.lines.some((line) => line.width > width.current));
    }
  }, []);
  return { ref, onLayout, onTextLayout, overflowing };
}
