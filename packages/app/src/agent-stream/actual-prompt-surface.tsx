import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { forwardRef, useImperativeHandle, useMemo } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useStableEvent } from "@/hooks/use-stable-event";
import { ActualPromptRowsProvider } from "./actual-prompt-rows";
import { PromptDiscoverySurface } from "./prompt-navigation-surface";
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

/** Own navigation/disclosure; the viewport pins its actual loaded message row. */
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
  const revealCurrent = useStableEvent(() => navigation.reveal());
  const { t } = useTranslation();
  const promptOutsideWindow =
    navigation.message &&
    !input.items.some((item) => item.kind === "user_message" && item.id === navigation.message?.id);

  useImperativeHandle(
    ref,
    () => ({
      followLatest: navigation.followLatest,
      reviewReading: navigation.reviewReading,
    }),
    [navigation.followLatest, navigation.reviewReading],
  );
  const rail = useMemo(
    () => ({ width: "100%" as const, maxWidth: contentMaxWidth }),
    [contentMaxWidth],
  );
  return (
    <ActualPromptRowsProvider
      enabled={input.enabled !== false}
      scope={`${serverId}:${agentId}:${input.epoch ?? "pending"}`}
      availableHeight={availableHeight}
    >
      <PromptNavigationContext.Provider value={input.enabled === false ? null : controls}>
        <View style={styles.timeline} testID="sticky-prompt-timeline">
          {children}
          {input.enabled !== false && (
            <View style={styles.feedback} pointerEvents="box-none">
              <View style={rail} pointerEvents="box-none">
                <PromptDiscoverySurface navigation={navigation} />
                {promptOutsideWindow && !navigation.busy && !navigation.error && (
                  <Button variant="ghost" size="md" onPress={revealCurrent}>
                    {t("stickyPrompt.goToMessage")}
                  </Button>
                )}
              </View>
            </View>
          )}
        </View>
      </PromptNavigationContext.Provider>
    </ActualPromptRowsProvider>
  );
});

const styles = StyleSheet.create({
  timeline: { flex: 1, minHeight: 0 },
  feedback: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 3, alignItems: "center" },
});
