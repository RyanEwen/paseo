import { PromptPixelOwnerContext } from "./prompt-bubble-geometry";
import {
  type ReactNode,
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { View, useWindowDimensions } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useStableEvent } from "@/hooks/use-stable-event";
import { useIsCompactFormFactor } from "@/constants/layout";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { PromptMessageSurface, PromptDiscoverySurface } from "./prompt-navigation-surface";
import { PromptNavigationContext } from "./prompt-navigation-actions";
import { usePromptNavigationControls } from "./use-prompt-navigation-controls";
import {
  fetchReadingPromptContext,
  normalContextPageReader,
  type ContextPageReader,
} from "./fetch-reading-prompt-context";
import type { StreamItem } from "@/types/stream";
import { fetchPromptContent } from "./fetch-prompt-content";
import { useStickyPrompt } from "./use-sticky-prompt";

type Props = Parameters<typeof useStickyPrompt>[0] & {
  contextPageReader?: ContextPageReader | null;
  serverId: string;
  agentId: string;
  client: DaemonClient | null;
  availableHeight: number;
  contentMaxWidth: number;
  children: ReactNode;
};

export interface StickyPromptHandle {
  followLatest(): void;
  reviewReading(): void;
}

/** Overlay a compact copy as the original bubble crosses the viewport top, without resizing the timeline viewport. */
export const StickyPrompt = forwardRef<StickyPromptHandle, Props>(function StickyPrompt(
  {
    serverId,
    agentId,
    client,
    contextPageReader,
    availableHeight,
    contentMaxWidth,
    children,
    ...input
  },
  ref,
) {
  const readPrompt = useStableEvent(async (seq: number) => {
    if (!client || !input.epoch) throw new Error("Prompt content is unavailable");
    return fetchPromptContent(client, agentId, input.epoch, seq);
  });
  const readContext = useStableEvent(async (source: StreamItem, signal: AbortSignal) => {
    if (!client || contextPageReader === null) throw new Error("Reading context is unavailable");
    return fetchReadingPromptContext(
      contextPageReader ?? normalContextPageReader(client, agentId),
      source,
      signal,
      contextPageReader ? "projected" : "canonical",
    );
  });
  const navigation = useStickyPrompt({
    ...input,
    fetchPrompt: readPrompt,
    fetchContext: readContext,
  });
  const controls = usePromptNavigationControls(navigation);
  const [disclosure, setDisclosure] = useState({ epoch: input.epoch, key: null as string | null });
  const expandedKey = disclosure.epoch === input.epoch ? disclosure.key : null;
  useLayoutEffect(() => {
    setDisclosure({ epoch: input.epoch, key: null });
  }, [input.epoch]);
  const compact = useIsCompactFormFactor();
  const { height } = useWindowDimensions();
  useImperativeHandle(
    ref,
    () => ({ followLatest: navigation.followLatest, reviewReading: navigation.reviewReading }),
    [navigation.followLatest, navigation.reviewReading],
  );
  const message = navigation.message;
  const contentStyle = useMemo(
    () => ({
      width: "100%" as const,
      maxWidth: navigation.geometry?.viewportWidth ?? contentMaxWidth,
    }),
    [contentMaxWidth, navigation.geometry?.viewportWidth],
  );
  const expandedScrollStyle = useMemo(
    // Bound the disclosure by the measured chat pane as well as the screen. Native
    // keyboards and short split panes can leave much less room than window height.
    () => ({ maxHeight: Math.min(height * (compact ? 0.3 : 0.4), availableHeight * 0.4) }),
    [availableHeight, compact, height],
  );
  const toggleExpanded = useStableEvent(() =>
    setDisclosure({
      epoch: input.epoch,
      key: expandedKey === message?.id ? null : (message?.id ?? null),
    }),
  );
  const expanded = expandedKey !== null && expandedKey === message?.id;
  const disclosureState = useMemo(() => ({ expanded }), [expanded]);
  const size = compact ? "md" : "sm";
  const pinnedPrefixHeight = compact
    ? navigation.geometry?.prefixHeightOne
    : navigation.geometry?.prefixHeightTwo;
  const pixelOwner = useMemo(
    () =>
      message && navigation.stickyVisible
        ? { id: message.id, expanded, prefixHeight: pinnedPrefixHeight ?? 0 }
        : null,
    [message, navigation.stickyVisible, expanded, pinnedPrefixHeight],
  );
  return (
    <PromptPixelOwnerContext.Provider value={pixelOwner}>
      <PromptNavigationContext.Provider value={input.enabled === false ? null : controls}>
        <View style={styles.timeline} testID="sticky-prompt-timeline">
          {children}
          <View style={styles.overlay} pointerEvents="box-none">
            <View style={contentStyle} pointerEvents="box-none">
              {input.enabled !== false &&
                (message && navigation.stickyVisible ? (
                  <PromptMessageSurface
                    navigation={navigation}
                    message={message}
                    serverId={serverId}
                    client={client}
                    expanded={expanded}
                    disclosureState={disclosureState}
                    toggleExpanded={toggleExpanded}
                    expandedScrollStyle={expandedScrollStyle}
                    size={size}
                  />
                ) : (
                  <PromptDiscoverySurface navigation={navigation} />
                ))}
            </View>
          </View>
        </View>
      </PromptNavigationContext.Provider>
    </PromptPixelOwnerContext.Provider>
  );
});

const styles = StyleSheet.create({
  timeline: { flex: 1, minHeight: 0 },
  overlay: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 2, alignItems: "center" },
});
