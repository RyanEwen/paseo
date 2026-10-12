import { RefreshControl } from "react-native";
import { useCallback, useMemo, useState } from "react";
import DraggableFlatList, {
  NestableDraggableFlatList,
  type RenderItemParams,
} from "react-native-draggable-flatlist";
import { Easing, LinearTransition, ReduceMotion } from "react-native-reanimated";
import { isDragGroupOrderValid } from "./drag-reorder/reorder-items";
import { usePositionTransitionDuration } from "./drag-reorder/use-position-transition";
import { useUnistyles } from "react-native-unistyles";
import type { DraggableListProps, DraggableRenderItemInfo } from "./draggable-list.types";

export type { DraggableListProps, DraggableRenderItemInfo };

const SCROLL_ENABLED_FLEX_STYLE = { flex: 1 };

export function DraggableList<T>({
  data,
  keyExtractor,
  renderItem,
  onDragEnd,
  getDragGroupKey,
  positionTransitionDuration,
  style,
  containerStyle,
  contentContainerStyle,
  testID,
  ListFooterComponent,
  ListHeaderComponent,
  ListEmptyComponent,
  showsVerticalScrollIndicator = true,
  scrollEnabled = true,
  useDragHandle: _useDragHandle = false,
  refreshing,
  onRefresh,
  extraData,
  simultaneousGestureRef,
  gestureHostPresented,
  waitFor,
  onDragBegin: onDragBeginProp,
  nestable = false,
}: DraggableListProps<T>) {
  const { theme } = useUnistyles();
  const [isDragging, setIsDragging] = useState(false);

  // Pass the ref directly to DraggableFlatList - it handles gesture
  // coordination internally for nestable lists.
  const simultaneousHandlers = useMemo(
    () => (simultaneousGestureRef ? [simultaneousGestureRef] : undefined),
    [simultaneousGestureRef],
  );

  const refreshColors = useMemo(
    () => [theme.colors.foregroundMuted],
    [theme.colors.foregroundMuted],
  );

  const handleRenderItem = useCallback(
    ({ item, drag, isActive, getIndex }: RenderItemParams<T>) => {
      const index = getIndex() ?? 0;
      const info: DraggableRenderItemInfo<T> = {
        item,
        index,
        drag: getDragGroupKey?.(item) === null ? () => {} : drag,
        isActive,
      };
      return renderItem(info);
    },
    [getDragGroupKey, renderItem],
  );

  const handleDragEnd = useCallback(
    ({ data: newData }: { data: T[] }) => {
      setIsDragging(false);
      if (
        getDragGroupKey &&
        !isDragGroupOrderValid({
          original: data,
          reordered: newData,
          keyExtractor,
          getDragGroupKey,
        })
      )
        return;
      onDragEnd(newData);
    },
    [data, getDragGroupKey, keyExtractor, onDragEnd],
  );

  const handleDragBegin = useCallback(() => {
    setIsDragging(true);
    onDragBeginProp?.();
  }, [onDragBeginProp]);

  const handleRelease = useCallback(() => {
    setIsDragging(false);
  }, []);

  const showRefreshControl = Boolean(onRefresh) && (!isDragging || Boolean(refreshing));
  const resolvedContainerStyle =
    containerStyle ?? (scrollEnabled ? SCROLL_ENABLED_FLEX_STYLE : undefined);
  const shouldShowRefreshControl = showRefreshControl && !nestable;
  const ListComponent: typeof DraggableFlatList = (
    nestable ? (NestableDraggableFlatList as unknown) : DraggableFlatList
  ) as typeof DraggableFlatList;

  const refreshControl = useMemo(
    () =>
      shouldShowRefreshControl ? (
        <RefreshControl
          refreshing={refreshing ?? false}
          onRefresh={onRefresh}
          tintColor={theme.colors.foregroundMuted}
          colors={refreshColors}
        />
      ) : undefined,
    [shouldShowRefreshControl, refreshing, onRefresh, theme.colors.foregroundMuted, refreshColors],
  );

  const motionKeys = data.flatMap((item, index) => {
    if (getDragGroupKey && getDragGroupKey(item) === null) return [];
    return [keyExtractor(item, index)];
  });
  const motionDuration = usePositionTransitionDuration({
    duration: positionTransitionDuration ?? 0,
    keys: motionKeys,
    dragging: isDragging || gestureHostPresented === false,
  });
  const itemLayoutAnimation = useMemo(
    () =>
      LinearTransition.duration(motionDuration)
        .easing(Easing.inOut(Easing.ease))
        .reduceMotion(ReduceMotion.System),
    [motionDuration],
  );

  const dragGroupKeys = useMemo(
    () => (getDragGroupKey ? data.map(getDragGroupKey) : undefined),
    [data, getDragGroupKey],
  );
  const listExtraData = useMemo(() => [extraData, motionDuration], [extraData, motionDuration]);

  return (
    <ListComponent
      testID={testID}
      data={data}
      keyExtractor={keyExtractor}
      renderItem={handleRenderItem}
      onDragEnd={handleDragEnd}
      style={style}
      containerStyle={resolvedContainerStyle}
      contentContainerStyle={contentContainerStyle}
      ListFooterComponent={ListFooterComponent}
      ListHeaderComponent={ListHeaderComponent}
      ListEmptyComponent={ListEmptyComponent}
      showsVerticalScrollIndicator={showsVerticalScrollIndicator}
      scrollEnabled={scrollEnabled}
      extraData={listExtraData}
      dragGroupKeys={dragGroupKeys}
      enableLayoutAnimationExperimental={positionTransitionDuration !== undefined}
      itemLayoutAnimation={itemLayoutAnimation}
      simultaneousHandlers={simultaneousHandlers}
      dragGestureHostPresented={gestureHostPresented}
      // Higher activation distance reduces accidental drag capture while nested
      // lists are inside a scroll container.
      activationDistance={20}
      onDragBegin={handleDragBegin}
      onRelease={handleRelease}
      // @ts-ignore - waitFor is supported by RNGH FlatList but missing from DraggableFlatList types
      waitFor={waitFor}
      refreshControl={refreshControl}
    />
  );
}
