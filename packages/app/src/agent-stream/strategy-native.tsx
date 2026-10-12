import {
  type ComponentRef,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  FlatList,
  Platform,
  View,
  type LayoutChangeEvent,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewStyle,
  type ViewToken,
} from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { withUnistyles } from "react-native-unistyles";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import type { StreamItem } from "@/types/stream";
import type { Theme } from "@/styles/theme";
import {
  resolveNativeReadingPosition,
  resolveNativeLivePromptOffset,
} from "./native-reading-position";
import { createNativePromptHandoffPair } from "./native-prompt-handoff";
import { resolvePromptHandoffProgress, type PromptHandoff } from "./prompt-handoff";
import { createNativePromptJumpController } from "./native-prompt-jump";
import { useStableEvent } from "@/hooks/use-stable-event";
import { useKeyboardStreamInset } from "@/keyboard/shift";
import { useRevisedHistoryRows } from "./history-row-revision";
import { useBottomAnchorController } from "./bottom-anchor-controller";
import { useScrollKeyboardDismiss } from "./scroll-keyboard-dismiss/use-scroll-keyboard-dismiss";
import type { StreamRenderInput, StreamStrategy, StreamViewportHandle } from "./strategy";
import {
  createStreamStrategy,
  isNearBottomForStreamRenderStrategy,
  resolveBottomAnchorTransportBehavior,
} from "./strategy";
import {
  abandonHistoryStartPaginationRequest,
  createHistoryStartPaginationState,
  evaluateHistoryStartPagination,
  isHistoryStartLoadingOperation,
  rearmHistoryStartPagination,
  settleHistoryStartPagination,
  type HistoryStartPaginationInput,
  type HistoryStartPaginationTransition,
} from "./history-start-pagination";
import {
  createHistoryStartSettleScheduler,
  type HistoryStartSettleScheduler,
} from "./history-start-settle-scheduler";

const DEFAULT_MAINTAIN_VISIBLE_CONTENT_POSITION = Object.freeze({
  minIndexForVisible: 0,
  autoscrollToTopThreshold: 0,
});

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const historyStartSlotStyle: ViewStyle = {
  alignItems: "center",
  justifyContent: "center",
  height: 32,
  flexShrink: 0,
};
const HISTORY_START_SETTLE_FRAMES = 2;

/** Record live-header row offsets without creating handlers during the parent's render. */
function MeasuredLiveRow({
  id,
  onMeasure,
  children,
}: {
  id: string;
  onMeasure: (id: string, offset: number, height: number) => void;
  children: React.ReactNode;
}) {
  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      onMeasure(id, event.nativeEvent.layout.y, event.nativeEvent.layout.height);
    },
    [id, onMeasure],
  );
  return <View onLayout={handleLayout}>{children}</View>;
}

/** Measure mounted history prompts through public native refs, without extra scroll ownership. */
function MeasuredHistoryPrompt({
  id,
  nodes,
  onLayout,
  children,
}: {
  id: string;
  nodes: Map<string, ComponentRef<typeof View>>;
  onLayout: () => void;
  children: React.ReactNode;
}) {
  const register = useCallback(
    (node: ComponentRef<typeof View> | null) => {
      if (node) nodes.set(id, node);
      else nodes.delete(id);
    },
    [id, nodes],
  );
  return (
    <View collapsable={false} ref={register} onLayout={onLayout}>
      {children}
    </View>
  );
}

function keyExtractor(item: { id: string }): string {
  return item.id;
}

function NativeStreamViewport(props: StreamRenderInput & { strategy: StreamStrategy }) {
  const {
    agentId,
    segments,
    historyRowRevision,
    liveHeadRowRevision,
    boundary,
    renderers,
    listEmptyComponent,
    viewportRef,
    routeBottomAnchorRequest,
    isAuthoritativeHistoryReady,
    onNearBottomChange,
    onNearHistoryStart,
    isLoadingOlderHistory,
    hasOlderHistory,
    olderHistoryProgressKey,
    scrollEnabled,
    listStyle,
    baseListContentContainerStyle,
    strategy,
  } = props;
  const { renderHistoryMountedRow, renderLiveHeadRow, renderLiveAuxiliary } = renderers;
  const reducedMotion = useReducedMotion();
  const flatListRef = useRef<FlatList<StreamItem>>(null);
  const liveHeaderHeightRef = useRef<number | null>(null);
  const livePromptOffsetsRef = useRef(new Map<string, number>());
  const liveGeometryRef = useRef(new Map<string, { y: number; height: number }>());
  const visibleHistoryRef = useRef<ViewToken<StreamItem>[]>([]);
  const navigatingPromptRef = useRef(false);
  const promptSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const streamViewportMetricsRef = useRef({
    containerKey: "native-virtualized",
    contentHeight: 0,
    viewportWidth: 0,
    viewportHeight: 0,
    offsetY: 0,
    viewportMeasuredForKey: null as string | null,
    contentMeasuredForKey: null as string | null,
  });
  const scrollOffsetYRef = useRef(0);
  const isUserScrollActiveRef = useRef(false);
  const scrollKeyboardDismiss = useScrollKeyboardDismiss();
  const streamKeyboardInset = useKeyboardStreamInset();
  const userScrollEndFrameIdRef = useRef<number | null>(null);
  const programmaticScrollEventBudgetRef = useRef(0);
  const isNativeViewportSettlingRef = useRef(false);
  const nativeViewportSettlingFrameIdRef = useRef<number | null>(null);
  const historyStartReadyRef = useRef(false);
  const [historyStartPaginationState, setHistoryStartPaginationState] = useState(
    createHistoryStartPaginationState,
  );
  const historyStartPaginationStateRef = useRef(historyStartPaginationState);
  const historyStartSettleSchedulerRef = useRef<HistoryStartSettleScheduler | null>(null);

  const historyItems = useMemo(() => {
    if (segments.historyVirtualized.length === 0) {
      return segments.historyMounted;
    }
    return [...segments.historyVirtualized, ...segments.historyMounted];
  }, [segments.historyMounted, segments.historyVirtualized]);
  const historyRows = useRevisedHistoryRows(historyItems, historyRowRevision);
  const getHistoryStartPaginationInput = useStableEvent((): HistoryStartPaginationInput => {
    const metrics = streamViewportMetricsRef.current;
    const hasMeasuredViewport =
      metrics.viewportMeasuredForKey === metrics.containerKey &&
      metrics.contentMeasuredForKey === metrics.containerKey;
    return {
      distanceFromHistoryStart: metrics.contentHeight - metrics.viewportHeight - metrics.offsetY,
      hasOlderHistory,
      isLoadingOlderHistory,
      isReady: historyStartReadyRef.current && hasMeasuredViewport,
      progressKey: olderHistoryProgressKey,
    };
  });
  const applyHistoryStartPaginationTransition = useStableEvent(
    (transition: HistoryStartPaginationTransition) => {
      const previousState = historyStartPaginationStateRef.current;
      historyStartPaginationStateRef.current = transition.state;
      if (transition.state !== previousState) {
        setHistoryStartPaginationState(transition.state);
      }
      if (transition.shouldLoad) {
        const requestedProgressKey = olderHistoryProgressKey;
        if (requestedProgressKey === null) {
          return;
        }
        void (async () => {
          const started = await onNearHistoryStart();
          if (started === true) {
            return;
          }
          applyHistoryStartPaginationTransition({
            state: abandonHistoryStartPaginationRequest(
              historyStartPaginationStateRef.current,
              requestedProgressKey,
            ),
            shouldLoad: false,
          });
        })();
      }
    },
  );
  const evaluateHistoryStart = useStableEvent(() => {
    const transition = evaluateHistoryStartPagination(
      historyStartPaginationStateRef.current,
      getHistoryStartPaginationInput(),
    );
    applyHistoryStartPaginationTransition(transition);
  });
  const scheduleHistoryStartSettle = useStableEvent(() => {
    let scheduler = historyStartSettleSchedulerRef.current;
    if (!scheduler) {
      scheduler = createHistoryStartSettleScheduler({
        settleFrames: HISTORY_START_SETTLE_FRAMES,
        requestFrame: requestAnimationFrame,
        cancelFrame: cancelAnimationFrame,
        isSettling: () => historyStartPaginationStateRef.current.status === "settling",
        isLoading: () => getHistoryStartPaginationInput().isLoadingOlderHistory,
        onSettle: () => {
          const transition = settleHistoryStartPagination(
            historyStartPaginationStateRef.current,
            getHistoryStartPaginationInput(),
          );
          applyHistoryStartPaginationTransition(transition);
        },
      });
      historyStartSettleSchedulerRef.current = scheduler;
    }
    scheduler.schedule();
  });

  const clearNativeViewportSettling = useCallback(() => {
    if (nativeViewportSettlingFrameIdRef.current !== null) {
      cancelAnimationFrame(nativeViewportSettlingFrameIdRef.current);
      nativeViewportSettlingFrameIdRef.current = null;
    }
  }, []);

  const clearPendingUserScrollEnd = useCallback(() => {
    if (userScrollEndFrameIdRef.current !== null) {
      cancelAnimationFrame(userScrollEndFrameIdRef.current);
      userScrollEndFrameIdRef.current = null;
    }
  }, []);

  const markNativeViewportSettling = useCallback(() => {
    clearNativeViewportSettling();
    isNativeViewportSettlingRef.current = true;
    let remainingFrames = 4;
    const tick = () => {
      if (remainingFrames <= 0) {
        nativeViewportSettlingFrameIdRef.current = null;
        isNativeViewportSettlingRef.current = false;
        return;
      }
      remainingFrames -= 1;
      nativeViewportSettlingFrameIdRef.current = requestAnimationFrame(tick);
    };
    nativeViewportSettlingFrameIdRef.current = requestAnimationFrame(tick);
  }, [clearNativeViewportSettling]);

  const getBottomAnchorTransportBehavior = useCallback(
    () =>
      resolveBottomAnchorTransportBehavior({
        strategy,
        isViewportSettling: isNativeViewportSettlingRef.current,
      }),
    [strategy],
  );

  const scrollToBottom = useCallback(
    (animated: boolean) => {
      programmaticScrollEventBudgetRef.current = 3;
      flatListRef.current?.scrollToOffset({
        offset: 0,
        animated,
      });
      scrollOffsetYRef.current = 0;
      streamViewportMetricsRef.current = {
        ...streamViewportMetricsRef.current,
        offsetY: 0,
      };
      onNearBottomChange(true);
    },
    [onNearBottomChange],
  );

  const bottomAnchorController = useBottomAnchorController({
    agentId,
    routeRequest: routeBottomAnchorRequest,
    isAuthoritativeHistoryReady,
    renderStrategy: "inverted-stream",
    getTransportBehavior: getBottomAnchorTransportBehavior,
    getMeasurementState: () => streamViewportMetricsRef.current,
    isNearBottom: () => {
      const metrics = streamViewportMetricsRef.current;
      return isNearBottomForStreamRenderStrategy({
        strategy,
        offsetY: metrics.offsetY,
        threshold: 32,
        contentHeight: metrics.contentHeight,
        viewportHeight: metrics.viewportHeight,
      });
    },
    scrollToBottom,
  });
  // Android's maintainVisibleContentPosition ignores the list inversion transform and
  // fights the controller's offset-zero correction while the live header grows.
  const maintainVisibleContentPosition =
    Platform.OS === "android" && bottomAnchorController.mode === "sticky-bottom"
      ? undefined
      : DEFAULT_MAINTAIN_VISIBLE_CONTENT_POSITION;
  const listContentContainerStyle = useMemo(
    () => [
      baseListContentContainerStyle,
      { paddingBottom: streamKeyboardInset.contentContainerPaddingBottom },
    ],
    [baseListContentContainerStyle, streamKeyboardInset.contentContainerPaddingBottom],
  );
  const listInsetProps = useMemo(
    () =>
      streamKeyboardInset.contentInset
        ? {
            automaticallyAdjustContentInsets: false,
            automaticallyAdjustsScrollIndicatorInsets: false,
            contentInsetAdjustmentBehavior: "never" as const,
            contentInset: streamKeyboardInset.contentInset,
            scrollIndicatorInsets: streamKeyboardInset.contentInset,
          }
        : {},
    [streamKeyboardInset.contentInset],
  );

  useEffect(() => {
    streamViewportMetricsRef.current = {
      containerKey: "native-virtualized",
      contentHeight: 0,
      viewportWidth: 0,
      viewportHeight: 0,
      offsetY: 0,
      viewportMeasuredForKey: null,
      contentMeasuredForKey: null,
    };
    scrollOffsetYRef.current = 0;
    isUserScrollActiveRef.current = false;
    clearPendingUserScrollEnd();
    clearNativeViewportSettling();
    isNativeViewportSettlingRef.current = false;
    historyStartReadyRef.current = false;
    const initialHistoryStartState = createHistoryStartPaginationState();
    historyStartPaginationStateRef.current = initialHistoryStartState;
    setHistoryStartPaginationState(initialHistoryStartState);
    const frame = requestAnimationFrame(() => {
      historyStartReadyRef.current = true;
      evaluateHistoryStart();
    });
    return () => {
      cancelAnimationFrame(frame);
      clearPendingUserScrollEnd();
      historyStartSettleSchedulerRef.current?.cancel();
      historyStartSettleSchedulerRef.current = null;
    };
  }, [agentId, clearNativeViewportSettling, clearPendingUserScrollEnd, evaluateHistoryStart]);

  useEffect(() => () => clearNativeViewportSettling(), [clearNativeViewportSettling]);

  useEffect(() => {
    bottomAnchorController.prepareForStickyContentChange();
  }, [bottomAnchorController, historyRows, segments.liveHead]);

  const findHistoryPromptIndex = useStableEvent((id: string) =>
    historyItems.findIndex((item) => item.id === id),
  );
  const reportPromptFailure = useStableEvent(() => props.onMessageNavigationError?.());
  const promptJumpController = useMemo(
    () =>
      createNativePromptJumpController({
        viewport: {
          findHistoryIndex: findHistoryPromptIndex,
          findLiveOffset: (id) => {
            const y = livePromptOffsetsRef.current.get(id);
            const header = liveHeaderHeightRef.current;
            if (y === undefined || header === null) return undefined;
            return resolveNativeLivePromptOffset(
              header,
              streamViewportMetricsRef.current.viewportHeight,
              y,
            );
          },
          getLiveHeaderHeight: () => liveHeaderHeightRef.current,
          scrollToIndex: (index) =>
            flatListRef.current?.scrollToIndex({
              index,
              animated: !reducedMotion,
              viewPosition: 1,
            }),
          scrollToOffset: (offset, animated) =>
            flatListRef.current?.scrollToOffset({ offset, animated: animated && !reducedMotion }),
        },
        scheduleRetry: (callback) => {
          const timer = setTimeout(callback, 100);
          return () => clearTimeout(timer);
        },
        now: () => performance.now(),
        onFailure: reportPromptFailure,
      }),
    [findHistoryPromptIndex, reportPromptFailure, reducedMotion],
  );
  const promptNodes = useRef(new Map<string, ComponentRef<typeof View>>());
  const measuredHandoff = useRef(new Map<string, PromptHandoff>());
  const reportReadingPosition = useStableEvent(() => {
    const metrics = streamViewportMetricsRef.current;
    const { rowId, visibleUserIds } = resolveNativeReadingPosition({
      visibleHistory: visibleHistoryRef.current,
      liveHead: segments.liveHead,
      liveGeometry: liveGeometryRef.current,
      headerHeight: liveHeaderHeightRef.current,
      viewportHeight: metrics.viewportHeight,
      offsetY: metrics.offsetY,
    });
    const userHandoffs: PromptHandoff[] = [];
    for (const handoff of measuredHandoff.current.values()) {
      if (visibleUserIds.includes(handoff.id)) userHandoffs.push(handoff);
    }
    if (liveHeaderHeightRef.current !== null) {
      const top = liveHeaderHeightRef.current - metrics.viewportHeight - metrics.offsetY;
      for (const item of segments.liveHead) {
        const geometry = liveGeometryRef.current.get(item.id);
        if (item.kind === "user_message" && geometry && visibleUserIds.includes(item.id))
          userHandoffs.push({
            id: item.id,
            progress: resolvePromptHandoffProgress(geometry.y - top),
            top: geometry.y - top,
          });
      }
    }
    props.onReadingPositionChange?.({
      userHandoffs,
      rowId,
      visibleUserIds,
      navigating: navigatingPromptRef.current,
      following: bottomAnchorController.mode === "sticky-bottom",
      manual: isUserScrollActiveRef.current,
    });
  });
  const handoffSampler = useMemo(
    () =>
      createNativePromptHandoffPair({
        measureViewport(callback) {
          const node = flatListRef.current?.getNativeScrollRef();
          if (node && "measureInWindow" in node) node.measureInWindow((_x, y) => callback(y));
          else callback(null);
        },
        measurePrompt(id, callback) {
          const node = promptNodes.current.get(id);
          if (node) node.measureInWindow((_x, y) => callback(y));
          else callback(null);
        },
        onMeasured(id, progress, top) {
          measuredHandoff.current.set(id, { id, progress, top });
          reportReadingPosition();
        },
      }),
    [reportReadingPosition],
  );
  const samplePromptHandoff = useStableEvent(() => {
    if (props.trackPromptHandoff === false) {
      handoffSampler.cancel();
      measuredHandoff.current.clear();
      return;
    }
    const ids = visibleHistoryRef.current
      .filter((token) => token.isViewable && token.item.kind === "user_message")
      .toSorted((a, b) => (b.index ?? 0) - (a.index ?? 0))
      .slice(0, 2)
      .map((token) => token.item.id);
    for (const id of measuredHandoff.current.keys()) {
      if (!ids.includes(id)) measuredHandoff.current.delete(id);
    }
    handoffSampler.sample(ids);
  });
  useEffect(() => {
    measuredHandoff.current.clear();
    handoffSampler.cancel();
    return () => handoffSampler.cancel();
  }, [agentId, handoffSampler, props.trackPromptHandoff]);
  const finishPromptAnimation = useStableEvent(() => {
    if (promptSettleTimerRef.current !== null) clearTimeout(promptSettleTimerRef.current);
    promptSettleTimerRef.current = null;
    navigatingPromptRef.current = false;
    reportReadingPosition();
  });
  const schedulePromptSettle = useStableEvent((delay: number) => {
    if (promptSettleTimerRef.current !== null) clearTimeout(promptSettleTimerRef.current);
    promptSettleTimerRef.current = setTimeout(() => {
      if (promptJumpController.isActive()) schedulePromptSettle(120);
      else finishPromptAnimation();
    }, delay);
  });
  const cancelPromptJump = useStableEvent(() => {
    promptJumpController.cancel();
    finishPromptAnimation();
  });
  const handleViewableItemsChanged = useStableEvent(
    ({ viewableItems }: { viewableItems: ViewToken<StreamItem>[] }) => {
      visibleHistoryRef.current = viewableItems;
      samplePromptHandoff();
      reportReadingPosition();
    },
  );
  const viewabilityConfig = useMemo(() => ({ itemVisiblePercentThreshold: 0 }), []);

  /** Detach once for a new intent; controller retries preserve the same target and budget. */
  const scrollToPrompt = useStableEvent((messageId: string) => {
    bottomAnchorController.detachByUser();
    navigatingPromptRef.current = true;
    promptJumpController.start(messageId);
    schedulePromptSettle(450);
  });

  useEffect(() => {
    cancelPromptJump();
    livePromptOffsetsRef.current.clear();
    liveGeometryRef.current.clear();
    visibleHistoryRef.current = [];
    liveHeaderHeightRef.current = null;
    return cancelPromptJump;
  }, [agentId, cancelPromptJump]);

  useEffect(() => {
    const handle: StreamViewportHandle = {
      scrollToBottom: (reason = "jump-to-bottom") => {
        cancelPromptJump();
        bottomAnchorController.requestLocalAnchor({
          agentId,
          reason,
        });
      },
      scrollToMessage: scrollToPrompt,
      cancelMessageScroll: cancelPromptJump,
      prepareForViewportChange: () => {
        bottomAnchorController.prepareForStickyViewportChange();
        markNativeViewportSettling();
      },
    };
    viewportRef.current = handle;
    return () => {
      if (viewportRef.current === handle) {
        viewportRef.current = null;
      }
    };
  }, [
    agentId,
    bottomAnchorController,
    cancelPromptJump,
    markNativeViewportSettling,
    scrollToPrompt,
    viewportRef,
  ]);

  const isScrollEventNearBottom = useStableEvent(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      return isNearBottomForStreamRenderStrategy({
        strategy,
        offsetY: contentOffset.y,
        threshold: 32,
        contentHeight: contentSize.height,
        viewportHeight: layoutMeasurement.height,
      });
    },
  );

  const handleScroll = useStableEvent((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const previousOffsetY = scrollOffsetYRef.current;
    scrollOffsetYRef.current = contentOffset.y;
    scrollKeyboardDismiss.onScroll(event);

    streamViewportMetricsRef.current = {
      contentHeight: Math.max(0, contentSize.height),
      viewportWidth: Math.max(0, layoutMeasurement.width),
      viewportHeight: Math.max(0, layoutMeasurement.height),
      containerKey: "native-virtualized",
      offsetY: contentOffset.y,
      viewportMeasuredForKey: "native-virtualized",
      contentMeasuredForKey: "native-virtualized",
    };

    samplePromptHandoff();
    reportReadingPosition();
    if (navigatingPromptRef.current) schedulePromptSettle(120);
    const nearBottom = isScrollEventNearBottom(event);
    onNearBottomChange(nearBottom);

    evaluateHistoryStart();

    if (
      !isUserScrollActiveRef.current &&
      programmaticScrollEventBudgetRef.current > 0 &&
      contentOffset.y <= 8
    ) {
      programmaticScrollEventBudgetRef.current -= 1;
    } else {
      programmaticScrollEventBudgetRef.current = 0;
      bottomAnchorController.handleScrollNearBottomChange({
        nextIsNearBottom: nearBottom,
        scrollDelta: contentOffset.y - previousOffsetY,
      });
    }
  });

  const handleScrollBeginDrag = useStableEvent((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    cancelPromptJump();
    clearPendingUserScrollEnd();
    isUserScrollActiveRef.current = true;
    reportReadingPosition();
    scrollKeyboardDismiss.onScrollBeginDrag(event);
    bottomAnchorController.beginUserScroll();
    const rearmed = rearmHistoryStartPagination(historyStartPaginationStateRef.current);
    if (rearmed !== historyStartPaginationStateRef.current) {
      historyStartPaginationStateRef.current = rearmed;
      setHistoryStartPaginationState(rearmed);
      evaluateHistoryStart();
    }
  });

  // Defer drag end so momentum can take ownership, but capture the terminal
  // gesture position now because layout may move the viewport in the meantime.
  const handleScrollEndDrag = useStableEvent((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const isNearBottom = isScrollEventNearBottom(event);
    scrollKeyboardDismiss.onScrollEndDrag(event);

    clearPendingUserScrollEnd();
    userScrollEndFrameIdRef.current = requestAnimationFrame(() => {
      userScrollEndFrameIdRef.current = null;
      isUserScrollActiveRef.current = false;
      bottomAnchorController.endUserScroll({ isNearBottom });
    });
  });

  const handleMomentumScrollBegin = useStableEvent(() => {
    clearPendingUserScrollEnd();
  });

  const handleMomentumScrollEnd = useStableEvent(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      // Android can emit momentum-end after a programmatic anchor correction.
      // Only momentum that still owns the user gesture may settle scroll intent.
      if (!isUserScrollActiveRef.current) {
        return;
      }
      const isNearBottom = isScrollEventNearBottom(event);
      clearPendingUserScrollEnd();
      isUserScrollActiveRef.current = false;
      bottomAnchorController.endUserScroll({ isNearBottom });
    },
  );

  const handleListLayout = useStableEvent((event: LayoutChangeEvent) => {
    const previousViewportWidth = streamViewportMetricsRef.current.viewportWidth;
    const previousViewportHeight = streamViewportMetricsRef.current.viewportHeight;
    const viewportWidth = Math.max(0, event.nativeEvent.layout.width);
    const viewportHeight = Math.max(0, event.nativeEvent.layout.height);
    const viewportChanged =
      (previousViewportWidth > 0 && previousViewportWidth !== viewportWidth) ||
      (previousViewportHeight > 0 && previousViewportHeight !== viewportHeight);
    streamViewportMetricsRef.current = {
      ...streamViewportMetricsRef.current,
      containerKey: "native-virtualized",
      viewportWidth,
      viewportHeight,
      viewportMeasuredForKey: "native-virtualized",
    };
    if (viewportChanged) {
      markNativeViewportSettling();
    }
    bottomAnchorController.handleViewportMetricsChange({
      previousViewportWidth,
      viewportWidth,
      previousViewportHeight,
      viewportHeight,
    });
    evaluateHistoryStart();
  });

  const handleContentSizeChange = useStableEvent((_width: number, height: number) => {
    const previousContentHeight = streamViewportMetricsRef.current.contentHeight;
    const nextContentHeight = Math.max(0, height);
    streamViewportMetricsRef.current = {
      ...streamViewportMetricsRef.current,
      containerKey: "native-virtualized",
      contentHeight: nextContentHeight,
      contentMeasuredForKey: "native-virtualized",
    };
    bottomAnchorController.handleContentSizeChange({
      previousContentHeight,
      contentHeight: nextContentHeight,
    });
    evaluateHistoryStart();
    if (historyStartPaginationStateRef.current.status === "settling") {
      scheduleHistoryStartSettle();
    }
  });

  useEffect(() => {
    evaluateHistoryStart();
    if (historyStartPaginationStateRef.current.status === "settling") {
      scheduleHistoryStartSettle();
    }
  }, [
    evaluateHistoryStart,
    hasOlderHistory,
    isLoadingOlderHistory,
    olderHistoryProgressKey,
    scheduleHistoryStartSettle,
  ]);

  const handleScrollToIndexFailed = promptJumpController.handleIndexFailure;

  const renderItem = useStableEvent(
    ({ item, index }: ListRenderItemInfo<StreamItem>): ReactElement | null => {
      const rendered = renderHistoryMountedRow(item, index, historyItems);
      if (item.kind !== "user_message" || !rendered)
        return (rendered ?? null) as ReactElement | null;
      return (
        <MeasuredHistoryPrompt
          id={item.id}
          nodes={promptNodes.current}
          onLayout={samplePromptHandoff}
        >
          {rendered}
        </MeasuredHistoryPrompt>
      );
    },
  );

  const recordLivePromptOffset = useStableEvent((id: string, offset: number, height: number) => {
    livePromptOffsetsRef.current.set(id, offset);
    liveGeometryRef.current.set(id, { y: offset, height });
    reportReadingPosition();
  });
  useEffect(() => {
    const liveIds = new Set(segments.liveHead.map((item) => item.id));
    for (const id of livePromptOffsetsRef.current.keys()) {
      if (!liveIds.has(id)) {
        livePromptOffsetsRef.current.delete(id);
        liveGeometryRef.current.delete(id);
      }
    }
  }, [segments.liveHead]);

  const recordLiveHeaderHeight = useStableEvent((event: LayoutChangeEvent) => {
    liveHeaderHeightRef.current = event.nativeEvent.layout.height;
    reportReadingPosition();
  });
  const liveHeaderContent = useMemo(() => {
    // Stable render events read the latest expansion state; this revision makes
    // the memo invoke them again when that state changes.
    void liveHeadRowRevision;
    const liveHeadRows = segments.liveHead.map((item, index) => (
      <MeasuredLiveRow key={item.id} id={item.id} onMeasure={recordLivePromptOffset}>
        {renderLiveHeadRow(item, index, segments.liveHead)}
      </MeasuredLiveRow>
    ));
    const liveAuxiliary = renderLiveAuxiliary();
    if (
      liveHeadRows.length === 0 &&
      !liveAuxiliary &&
      !boundary.hasMountedHistory &&
      !boundary.hasVirtualizedHistory
    ) {
      return (listEmptyComponent ?? null) as ReactElement | null;
    }
    return (
      <View onLayout={recordLiveHeaderHeight}>
        {liveHeadRows}
        {liveAuxiliary}
      </View>
    );
  }, [
    boundary,
    listEmptyComponent,
    liveHeadRowRevision,
    renderLiveAuxiliary,
    renderLiveHeadRow,
    segments.liveHead,
    recordLivePromptOffset,
    recordLiveHeaderHeight,
  ]);

  const historyFooterContent = useMemo(() => {
    const isLoadingOperation = isHistoryStartLoadingOperation(historyStartPaginationState);
    return (
      <View style={historyStartSlotStyle} testID="older-history-slot">
        {isLoadingOperation ? (
          <View testID="load-older-history-spinner">
            <ThemedLoadingSpinner size="small" uniProps={foregroundMutedColorMapping} />
          </View>
        ) : null}
      </View>
    );
  }, [historyStartPaginationState]);

  // RN's FlatList strictMode keeps its internal renderItem wrapper stable when
  // data or the live header changes, preserving the row identities above.
  return (
    <FlatList
      {...listInsetProps}
      ref={flatListRef}
      data={historyRows}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      strictMode
      testID="agent-chat-scroll"
      nativeID="agent-chat-scroll-native-virtualized"
      ListHeaderComponent={liveHeaderContent ?? undefined}
      ListFooterComponent={historyFooterContent ?? undefined}
      contentContainerStyle={listContentContainerStyle}
      style={listStyle}
      onLayout={handleListLayout}
      onScroll={handleScroll}
      onScrollBeginDrag={handleScrollBeginDrag}
      onScrollEndDrag={handleScrollEndDrag}
      onMomentumScrollBegin={handleMomentumScrollBegin}
      onMomentumScrollEnd={handleMomentumScrollEnd}
      scrollEventThrottle={16}
      onContentSizeChange={handleContentSizeChange}
      maintainVisibleContentPosition={maintainVisibleContentPosition}
      onScrollToIndexFailed={handleScrollToIndexFailed}
      onViewableItemsChanged={handleViewableItemsChanged}
      viewabilityConfig={viewabilityConfig}
      initialNumToRender={12}
      windowSize={10}
      removeClippedSubviews={false}
      scrollEnabled={scrollEnabled}
      showsVerticalScrollIndicator
      inverted
    />
  );
}

export function createNativeStreamStrategy(): StreamStrategy {
  const strategy = createStreamStrategy({
    render: (renderInput) => <NativeStreamViewport {...renderInput} strategy={strategy} />,
    orderTailReverse: true,
    orderHeadReverse: true,
    assistantTurnTraversalStep: 1,
    edgeSlot: "header",
    historyLiveBoundaryEdge: "first",
    liveHeadHistoryBoundaryEdge: "last",
    frameChildOrder: "footer-then-content",
    flatListInverted: true,
    overlayScrollbarInverted: true,
    maintainVisibleContentPosition: DEFAULT_MAINTAIN_VISIBLE_CONTENT_POSITION,
    bottomAnchorTransportBehavior: {
      verificationDelayFrames: 2,
      verificationRetryMode: "recheck",
    },
    disableParentScrollOnInlineDetailsExpansion: false,
    anchorBottomOnContentSizeChange: false,
    animateManualScrollToBottom: true,
    useVirtualizedList: true,
    isNearBottom: (input) => input.offsetY <= input.threshold,
    getBottomOffset: () => 0,
  });
  return strategy;
}
