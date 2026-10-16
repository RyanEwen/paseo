import { useLayoutEffect } from "react";
import { NativeStickyLayoutContext } from "./native-sticky-layout-context";
import { useContext } from "react";
import { useAnimatedRef, useScrollOffset } from "react-native-reanimated";
import { useDockReservation } from "@/keyboard/shift/internal/dock-reservation";
import { ActualPromptRowsContext, ActualPinnedRowContext } from "./actual-prompt-rows";
import { ActualStickyHeader, NativeActualMotionBoundary } from "./actual-sticky-header";
import {
  NativeStickyViewportProvider,
  useNativeReadingRefresh,
  useNativeMeasurementContext,
} from "./native-sticky-viewport";
import {
  nativeBottomDistance,
  nativeOriginalTop,
  nativeChronologicalRows,
  resolveActualNativeReading,
  resolveNativeMeasurementOwner,
} from "./native-actual-row-model";
import type { PromptJumpPlacement } from "./prompt-jump-placement";
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  View,
  type LayoutChangeEvent,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewStyle,
} from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { withUnistyles } from "react-native-unistyles";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import type { StreamItem } from "@/types/stream";
import type { Theme } from "@/styles/theme";
import { createNativePromptJumpController } from "./native-prompt-jump";
import { useStableEvent } from "@/hooks/use-stable-event";
import { useRevisedHistoryRows } from "./history-row-revision";
import { useBottomAnchorController } from "./bottom-anchor-controller";
import { useScrollKeyboardDismiss } from "./scroll-keyboard-dismiss/use-scroll-keyboard-dismiss";
import type {
  StreamRenderInput,
  StreamStrategy,
  StreamViewportHandle,
  ScrollToMessageOccurrence,
} from "./strategy";
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
  minHeight: 32,
  flexGrow: 1,
  flexShrink: 0,
};
const leadingSlotStyle: ViewStyle = { flexGrow: 1 };
const HELD_READING_POSITION = Object.freeze({ minIndexForVisible: 1 });
const HISTORY_START_SETTLE_FRAMES = 2;

/** Cell type is stable across current-turn completion and history prepends. RN's
 * sticky wrapper forwards this onLayout once; children never own absolute L. */
function createActualCellRenderer(
  record: (id: string, index: number, y: number, height: number) => void,
  mount: (id: string, mounted: boolean) => void,
) {
  return function ActualCell({
    item,
    index,
    onLayout,
    children,
    style,
    onFocusCapture,
  }: import("react-native").CellRendererProps<StreamItem>) {
    const sticky = useContext(NativeStickyLayoutContext);
    useLayoutEffect(() => {
      mount(item.id, true);
      return () => mount(item.id, false);
    }, [item.id]);
    const measure = useCallback(
      (event: LayoutChangeEvent) => {
        record(item.id, index, event.nativeEvent.layout.y, event.nativeEvent.layout.height);
        onLayout?.(event);
      },
      [item.id, index, onLayout],
    );
    useLayoutEffect(() => sticky?.subscribe(measure), [sticky, measure]);
    // RN forwards this capture callback, but its public ViewProps omits the field.
    const focusProps = useMemo(() => ({ onFocusCapture }), [onFocusCapture]);
    return (
      <View
        {...focusProps}
        onLayout={sticky ? undefined : measure}
        collapsable={false}
        style={[style, { overflow: "visible" }]}
      >
        {children}
      </View>
    );
  };
}

function keyExtractor(item: { id: string }): string {
  return item.id;
}

function NativeStreamViewport(props: StreamRenderInput & { strategy: StreamStrategy }) {
  return (
    <NativeActualMotionBoundary allowStandalone={props.nativeViewportPlacement === "standalone"}>
      <NativeActualViewport {...props} />
    </NativeActualMotionBoundary>
  );
}
function NativeActualViewport(props: StreamRenderInput & { strategy: StreamStrategy }) {
  const {
    agentId,
    segments,
    historyRowRevision,
    liveHeadRowRevision,
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
  const nativeOwnerAlive = useRef(true);
  useLayoutEffect(() => {
    nativeOwnerAlive.current = true;
    return () => {
      nativeOwnerAlive.current = false;
    };
  }, []);
  const reducedMotion = useReducedMotion();
  const flatListRef = useAnimatedRef<FlatList<StreamItem>>();
  const nativeY = useScrollOffset(flatListRef);
  const nativeStickyViewport = useMemo(() => ({ y: nativeY }), [nativeY]);
  const reservationSnapshot = useDockReservation();
  const reservation = reservationSnapshot.extent;
  const measurementContext = useNativeMeasurementContext();
  const getMeasurementOwner = useStableEvent(() => {
    const viewport = flatListRef.current?.getNativeScrollRef();
    if (!viewport || !("measureInWindow" in viewport)) return null;
    return resolveNativeMeasurementOwner<
      Pick<import("react-native").NativeMethods, "measureInWindow">
    >(measurementContext.mode, viewport, measurementContext.stationaryViewportRef?.current ?? null);
  });
  const actualRows = useContext(ActualPromptRowsContext);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const mountedRows = useRef(new Set<string>());
  const actualGeometry = useRef(new Map<string, { index: number; y: number; height: number }>());
  const [geometryRevision, setGeometryRevision] = useState(0);
  const expandActual = actualRows?.expand;
  const registerActualViewport = actualRows?.registerViewport;
  const reportActualHeight = actualRows?.reportViewportHeight;
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
  const scrollKeyboardDismiss = useScrollKeyboardDismiss(strategy.getFlatListInverted());

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

  const historyItems = useMemo(() => nativeChronologicalRows(segments), [segments]);
  const historyRows = useRevisedHistoryRows(historyItems, historyRowRevision);
  const getHistoryStartPaginationInput = useStableEvent((): HistoryStartPaginationInput => {
    const metrics = streamViewportMetricsRef.current;
    const hasMeasuredViewport =
      metrics.viewportMeasuredForKey === metrics.containerKey &&
      metrics.contentMeasuredForKey === metrics.containerKey;
    return {
      distanceFromHistoryStart: metrics.offsetY,
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

  const scrollToBottom = useStableEvent((animated: boolean) => {
    programmaticScrollEventBudgetRef.current = 3;
    const offset = Math.max(
      0,
      streamViewportMetricsRef.current.contentHeight -
        streamViewportMetricsRef.current.viewportHeight,
    );
    flatListRef.current?.scrollToOffset({
      offset,
      animated,
    });
    scrollOffsetYRef.current = offset;
    streamViewportMetricsRef.current = {
      ...streamViewportMetricsRef.current,
      offsetY: offset,
    };
    onNearBottomChange(true);
  });

  const bottomAnchorController = useBottomAnchorController({
    agentId,
    routeRequest: routeBottomAnchorRequest,
    isAuthoritativeHistoryReady,
    renderStrategy: "chronological-native-stream",
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
  // Only RN preserves the held reading cell on prepends. The existing bottom
  // controller owns follow corrections; disable competing RN auto-follow.
  const maintainVisibleContentPosition =
    bottomAnchorController.mode === "sticky-bottom" ? undefined : HELD_READING_POSITION;
  const lastReservation = useRef(reservation);
  useLayoutEffect(() => {
    if (lastReservation.current === reservation) return;
    lastReservation.current = reservation;
    bottomAnchorController.prepareForStickyViewportChange();
  }, [reservation, bottomAnchorController]);

  const listContentContainerStyle = useMemo(
    () => [baseListContentContainerStyle, { paddingTop: reservation }],
    [baseListContentContainerStyle, reservation],
  );
  const listInsetProps = {
    automaticallyAdjustContentInsets: false,
    automaticallyAdjustsScrollIndicatorInsets: false,
    contentInsetAdjustmentBehavior: "never" as const,
  };
  useEffect(
    () =>
      registerActualViewport?.(() => {
        bottomAnchorController.prepareForStickyContentChange();
      }),
    [registerActualViewport, bottomAnchorController],
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
  const getLeadingExtent = useStableEvent(() => {
    const first = historyItems[0];
    return first ? (actualGeometry.current.get(first.id)?.y ?? null) : null;
  });
  const reportPromptFailure = useStableEvent(() => props.onMessageNavigationError?.());
  const promptJumpController = useMemo(
    () =>
      createNativePromptJumpController({
        direction: "chronological",
        viewport: {
          findHistoryIndex: findHistoryPromptIndex,
          findLiveOffset: () => undefined,
          getLiveHeaderHeight: getLeadingExtent,
          measureTarget: (id, callback) => {
            const row = actualGeometry.current.get(id);
            const owner = getMeasurementOwner();
            const viewport = owner?.viewport;
            const clip = owner?.clip;
            if (
              !row ||
              !mountedRows.current.has(id) ||
              row.index !== findHistoryPromptIndex(id) ||
              !viewport ||
              !("measureInWindow" in viewport) ||
              !clip
            ) {
              callback(null);
              return;
            }
            clip.measureInWindow((_clipX, clipY) =>
              viewport.measureInWindow((_x, listY) => {
                const metrics = streamViewportMetricsRef.current;
                if (
                  !mountedRows.current.has(id) ||
                  actualGeometry.current.get(id) !== row ||
                  getMeasurementOwner()?.viewport !== viewport ||
                  getMeasurementOwner()?.clip !== clip ||
                  row.index !== findHistoryPromptIndex(id)
                ) {
                  callback(null);
                  return;
                }
                callback({
                  top: nativeOriginalTop(row.y, metrics.offsetY, listY, clipY),
                  offset: metrics.offsetY,
                  maxOffset: Math.max(0, metrics.contentHeight - metrics.viewportHeight),
                });
              }),
            );
          },
          scrollToIndex: (index) =>
            flatListRef.current?.scrollToIndex({
              index,
              animated: !reducedMotion,
              viewPosition: 0,
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
    [
      findHistoryPromptIndex,
      reportPromptFailure,
      reducedMotion,
      getLeadingExtent,
      getMeasurementOwner,
      flatListRef,
    ],
  );
  useEffect(() => () => promptJumpController.cancel(), [promptJumpController]);
  const readingRequest = useRef(0);
  const reportReadingPosition = useStableEvent(() => {
    if (!nativeOwnerAlive.current) return;
    const owner = getMeasurementOwner();
    if (!owner) return;
    const { viewport, clip } = owner;
    const request = ++readingRequest.current;
    clip.measureInWindow((_clipX, clipY) =>
      viewport.measureInWindow((_x, listY) => {
        if (
          !nativeOwnerAlive.current ||
          request !== readingRequest.current ||
          getMeasurementOwner()?.viewport !== viewport ||
          getMeasurementOwner()?.clip !== clip
        )
          return;
        const m = streamViewportMetricsRef.current;
        const clippedLeading = Math.max(0, clipY - listY);
        reportActualHeight?.(
          Math.max(0, Math.min(m.viewportHeight - reservation, m.viewportHeight - clippedLeading)),
        );
        const { pinnedId: readingPinnedId, ...position } = resolveActualNativeReading({
          items: historyItems,
          geometry: actualGeometry.current,
          mounted: mountedRows.current,
          offset: m.offsetY,
          viewportHeight: m.viewportHeight,
          clippedLeading,
          stickyEnabled: actualRows !== null,
        });
        setPinnedId(readingPinnedId);
        props.onReadingPositionChange?.({
          ...position,
          viewportWidth: m.viewportWidth,
          userHandoffs: [],
          navigating: navigatingPromptRef.current,
          following: bottomAnchorController.mode === "sticky-bottom",
          manual: isUserScrollActiveRef.current,
        });
      }),
    );
  });
  const invalidateReading = useStableEvent(() => {
    readingRequest.current += 1;
  });
  useNativeReadingRefresh(
    reservationSnapshot,
    reportReadingPosition,
    invalidateReading,
    measurementContext,
  );
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
  const handleViewableItemsChanged = useStableEvent(() => {
    reportReadingPosition();
  });
  const viewabilityConfig = useMemo(() => ({ itemVisiblePercentThreshold: 0 }), []);

  /** Detach once for a new intent; controller retries preserve the same target and budget. */
  const scrollToPrompt = useStableEvent(
    (
      messageId: string,
      _occurrence?: ScrollToMessageOccurrence,
      placement?: PromptJumpPlacement,
    ) => {
      bottomAnchorController.detachByUser();
      navigatingPromptRef.current = true;
      promptJumpController.start(messageId, placement);
      schedulePromptSettle(450);
    },
  );

  useEffect(() => {
    cancelPromptJump();
    actualGeometry.current.clear();
    setPinnedId(null);
    return cancelPromptJump;
  }, [agentId, cancelPromptJump]);

  useEffect(() => {
    cancelPromptJump();
  }, [actualRows?.scope, cancelPromptJump]);

  useEffect(() => {
    const handle: StreamViewportHandle = {
      scrollToBottom: (reason = "jump-to-bottom") => {
        cancelPromptJump();
        bottomAnchorController.requestLocalAnchor({
          agentId,
          reason,
        });
      },
      expandMessageForFind: (id, signal) => {
        if (!signal.aborted) expandActual?.(id);
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
    expandActual,
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

    reportReadingPosition();
    if (navigatingPromptRef.current) schedulePromptSettle(120);
    const nearBottom = isScrollEventNearBottom(event);
    onNearBottomChange(nearBottom);

    evaluateHistoryStart();

    if (
      !isUserScrollActiveRef.current &&
      programmaticScrollEventBudgetRef.current > 0 &&
      nearBottom
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
    reportReadingPosition();
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

  const recordRow = useStableEvent((id: string, index: number, y: number, height: number) => {
    const previous = actualGeometry.current.get(id);
    if (previous?.y === y && previous.height === height && previous.index === index) return;
    actualGeometry.current.set(id, { index, y, height });
    setGeometryRevision((value) => value + 1);
    reportReadingPosition();
  });
  const renderItem = useStableEvent(
    ({ item, index }: ListRenderItemInfo<StreamItem>): ReactElement | null => (
      <ActualPinnedRowContext.Provider value={pinnedId === item.id}>
        {segments.liveHead.some((live) => live.id === item.id)
          ? renderLiveHeadRow(item, index, historyItems)
          : renderHistoryMountedRow(item, index, historyItems)}
      </ActualPinnedRowContext.Provider>
    ),
  );
  const markRowMounted = useStableEvent((id: string, mounted: boolean) => {
    if (mounted) mountedRows.current.add(id);
    else mountedRows.current.delete(id);
  });
  const CellRendererComponent = useMemo(
    () => createActualCellRenderer(recordRow, markRowMounted),
    [recordRow, markRowMounted],
  );
  const stickyHeaderIndices = useMemo(
    () => historyItems.flatMap((item, index) => (item.kind === "user_message" ? [index + 1] : [])),
    [historyItems],
  );
  const listExtraData = useMemo(
    () => ({
      historyRowRevision,
      liveHeadRowRevision,
      pinnedId,
      expanded: actualRows?.expandedIds,
      geometryRevision,
    }),
    [historyRowRevision, liveHeadRowRevision, pinnedId, actualRows?.expandedIds, geometryRevision],
  );
  useEffect(() => {
    const ids = new Set(historyItems.map((item) => item.id));
    for (const id of actualGeometry.current.keys())
      if (!ids.has(id)) actualGeometry.current.delete(id);
  }, [historyItems]);
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

  const footerContent = useMemo(() => <View>{renderLiveAuxiliary()}</View>, [renderLiveAuxiliary]);
  const emptyContent = useMemo(() => <View>{listEmptyComponent}</View>, [listEmptyComponent]);
  // One stable cell type and key cover both history and live revisions. RN retains
  // the closest preceding sticky cell in its own render mask (loader offset1).
  return (
    <NativeStickyViewportProvider value={nativeStickyViewport}>
      <FlatList
        {...listInsetProps}
        ref={flatListRef}
        data={historyRows}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        strictMode
        testID="agent-chat-scroll"
        nativeID="agent-chat-scroll-native-virtualized"
        CellRendererComponent={CellRendererComponent}
        extraData={listExtraData}
        stickyHeaderIndices={stickyHeaderIndices}
        StickyHeaderComponent={ActualStickyHeader}
        ListHeaderComponent={historyFooterContent}
        ListHeaderComponentStyle={leadingSlotStyle}
        ListFooterComponent={footerContent}
        ListEmptyComponent={emptyContent}
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
      />
    </NativeStickyViewportProvider>
  );
}

export function createNativeStreamStrategy(): StreamStrategy {
  const strategy = createStreamStrategy({
    render: (renderInput) => <NativeStreamViewport {...renderInput} strategy={strategy} />,
    orderTailReverse: false,
    orderHeadReverse: false,
    assistantTurnTraversalStep: -1,
    edgeSlot: "footer",
    historyLiveBoundaryEdge: "last",
    liveHeadHistoryBoundaryEdge: "first",
    frameChildOrder: "content-then-footer",
    flatListInverted: false,
    overlayScrollbarInverted: false,
    maintainVisibleContentPosition: DEFAULT_MAINTAIN_VISIBLE_CONTENT_POSITION,
    bottomAnchorTransportBehavior: {
      verificationDelayFrames: 2,
      verificationRetryMode: "recheck",
    },
    disableParentScrollOnInlineDetailsExpansion: false,
    anchorBottomOnContentSizeChange: false,
    animateManualScrollToBottom: true,
    useVirtualizedList: true,
    isNearBottom: (input) =>
      nativeBottomDistance(input.contentHeight, 0, input.viewportHeight, input.offsetY) <=
      input.threshold,
    getBottomOffset: (input) => Math.max(0, input.contentHeight - input.viewportHeight),
  });
  return strategy;
}
