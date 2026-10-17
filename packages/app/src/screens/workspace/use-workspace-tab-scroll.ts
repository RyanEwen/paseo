import { useCallback, useLayoutEffect, useRef } from "react";
import { ScrollView, type LayoutChangeEvent } from "react-native";
import type { SharedValue } from "react-native-reanimated";
import { resolveWorkspaceTabScrollOffset } from "./workspace-tab-layout";

/**
 * Reveal the selected tab after native measurements, selection, or viewport changes.
 * The shared scroll offset follows user scrolling without a React update for every frame.
 */
export function useWorkspaceTabScroll({
  activeTabKey,
  enabled,
  offset,
}: {
  activeTabKey: string | undefined;
  enabled: boolean;
  offset: SharedValue<number>;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const geometry = useRef({ viewportWidth: 0, contentWidth: 0 });
  const tabFrames = useRef(new Map<string, { x: number; width: number }>());

  const revealActiveTab = useCallback(() => {
    if (!enabled || !activeTabKey) {
      return;
    }
    const frame = tabFrames.current.get(activeTabKey);
    if (!frame) {
      return;
    }

    const nextOffset = resolveWorkspaceTabScrollOffset({
      ...geometry.current,
      offset: offset.value,
      tabStart: frame.x,
      tabWidth: frame.width,
    });
    scrollRef.current?.scrollTo({ x: nextOffset, animated: false });
  }, [activeTabKey, enabled, offset]);

  useLayoutEffect(revealActiveTab, [revealActiveTab]);

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      geometry.current.viewportWidth = event.nativeEvent.layout.width;
      revealActiveTab();
    },
    [revealActiveTab],
  );

  const onContentSizeChange = useCallback(
    (width: number) => {
      geometry.current.contentWidth = width;
      revealActiveTab();
    },
    [revealActiveTab],
  );

  const onTabLayout = useCallback(
    (tabKey: string, event: LayoutChangeEvent) => {
      tabFrames.current.set(tabKey, event.nativeEvent.layout);
      revealActiveTab();
    },
    [revealActiveTab],
  );

  return { scrollRef, onLayout, onContentSizeChange, onTabLayout };
}
