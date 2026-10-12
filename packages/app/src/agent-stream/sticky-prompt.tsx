import { type ReactNode, forwardRef, useImperativeHandle, useMemo, useState } from "react";
import { View, useWindowDimensions } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useStableEvent } from "@/hooks/use-stable-event";
import { useIsCompactFormFactor } from "@/constants/layout";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { PromptMessageSurface, PromptDiscoverySurface } from "./prompt-navigation-surface";
import { PromptNavigationContext } from "./prompt-navigation-actions";
import { usePromptNavigationControls } from "./use-prompt-navigation-controls";
import { fetchPromptContent } from "./fetch-prompt-content";
import { useStickyPrompt } from "./use-sticky-prompt";

type Props = Parameters<typeof useStickyPrompt>[0] & {
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

/** Overlay the original bubble after it leaves view, without resizing the timeline viewport. */
export const StickyPrompt = forwardRef<StickyPromptHandle, Props>(function StickyPrompt(
  { serverId, agentId, client, availableHeight, contentMaxWidth, children, ...input },
  ref,
) {
  const readPrompt = useStableEvent(async (seq: number) => {
    if (!client || !input.epoch) throw new Error("Prompt content is unavailable");
    return fetchPromptContent(client, agentId, input.epoch, seq);
  });
  const navigation = useStickyPrompt({ ...input, fetchPrompt: readPrompt });
  const controls = usePromptNavigationControls(navigation);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const compact = useIsCompactFormFactor();
  const { height } = useWindowDimensions();
  useImperativeHandle(
    ref,
    () => ({ followLatest: navigation.followLatest, reviewReading: navigation.reviewReading }),
    [navigation.followLatest, navigation.reviewReading],
  );
  const message = navigation.message;
  const contentStyle = useMemo(
    () => ({ width: "100%" as const, maxWidth: contentMaxWidth }),
    [contentMaxWidth],
  );
  const expandedScrollStyle = useMemo(
    // Bound the disclosure by the measured chat pane as well as the screen. Native
    // keyboards and short split panes can leave much less room than window height.
    () => ({ maxHeight: Math.min(height * (compact ? 0.3 : 0.4), availableHeight * 0.4) }),
    [availableHeight, compact, height],
  );
  const toggleExpanded = useStableEvent(() =>
    setExpandedKey(expandedKey === message?.id ? null : (message?.id ?? null)),
  );
  const expanded = expandedKey !== null && expandedKey === message?.id;
  const disclosureState = useMemo(() => ({ expanded }), [expanded]);
  const size = compact ? "md" : "sm";
  return (
    <PromptNavigationContext.Provider value={controls}>
      <View style={styles.timeline} testID="sticky-prompt-timeline">
        {children}
        <View style={styles.overlay} pointerEvents="box-none">
          <View style={contentStyle} pointerEvents="box-none">
            {message && navigation.stickyVisible ? (
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
            )}
          </View>
        </View>
      </View>
    </PromptNavigationContext.Provider>
  );
});

const styles = StyleSheet.create({
  timeline: { flex: 1, minHeight: 0 },
  overlay: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 2, alignItems: "center" },
});
