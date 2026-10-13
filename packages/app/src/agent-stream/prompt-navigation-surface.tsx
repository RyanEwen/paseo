import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { isWeb } from "@/constants/platform";
import { useStableEvent } from "@/hooks/use-stable-event";
import { useMemo, useState } from "react";
import { Text, View, ScrollView, type ViewStyle, type GestureResponderEvent } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { UserMessage } from "@/components/message";
import { useIsCompactFormFactor } from "@/constants/layout";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { useStickyPrompt } from "./use-sticky-prompt";
import type { UserPrompt } from "./sticky-prompt-model";

/** Render a compact copy with disclosure and navigation using the original message renderer. */
export function PromptMessageSurface({
  navigation,
  message,
  serverId,
  client,
  expanded,
  disclosureState,
  toggleExpanded,
  expandedScrollStyle,
  size,
}: {
  navigation: ReturnType<typeof useStickyPrompt>;
  message: UserPrompt;
  serverId: string;
  client: DaemonClient | null;
  expanded: boolean;
  disclosureState: { expanded: boolean };
  toggleExpanded: () => void;
  expandedScrollStyle: ViewStyle;
  size: "md" | "sm";
}) {
  const { t } = useTranslation();
  const compact = useIsCompactFormFactor();
  const previewLines = compact ? 1 : 2;
  const revealMessage = useStableEvent((event: GestureResponderEvent) => {
    if (isWeb) {
      const selection = window.getSelection();
      const currentTarget: unknown = event.currentTarget;
      const keyboard = event.nativeEvent instanceof KeyboardEvent;
      if (
        !keyboard &&
        selection &&
        !selection.isCollapsed &&
        currentTarget instanceof HTMLElement &&
        (currentTarget.contains(selection.anchorNode) ||
          currentTarget.contains(selection.focusNode))
      ) {
        return;
      }
    }
    navigation.reveal();
  });
  const [textOverflow, setTextOverflow] = useState({
    id: message.id,
    text: message.text,
    lines: previewLines,
    hidden: false,
  });
  const reportTextOverflow = useStableEvent((hidden: boolean) => {
    setTextOverflow((current) =>
      current.id === message.id &&
      current.text === message.text &&
      current.lines === previewLines &&
      current.hidden === hidden
        ? current
        : { id: message.id, text: message.text, lines: previewLines, hidden },
    );
  });
  // A compact attachment summary omits the real attachment pills. Text disclosure,
  // however, is driven only by the full renderer's measured wrapping.
  const hidesContent = hidesPromptPreviewContent(message, textOverflow, previewLines);
  const surfaceStyle = useMemo(
    () => [
      styles.container,
      navigation.geometry
        ? inlineUnistylesStyle({
            paddingLeft: navigation.geometry.left,
            paddingRight:
              navigation.geometry.viewportWidth -
              navigation.geometry.left -
              navigation.geometry.width,
          })
        : undefined,
    ],
    [navigation.geometry],
  );
  const clipStyle = useMemo(
    () => inlineUnistylesStyle({ overflow: "hidden" as const, maxHeight: navigation.occlusionTop }),
    [navigation.occlusionTop],
  );
  const disclosure = useMemo(
    () =>
      expanded || hidesContent ? (
        <Button
          variant="ghost"
          size={size}
          accessibilityLabel={expanded ? t("stickyPrompt.collapse") : t("stickyPrompt.expand")}
          accessibilityState={disclosureState}
          onPress={toggleExpanded}
          testID="sticky-user-message-disclosure"
        >
          {expanded ? t("stickyPrompt.less") : t("stickyPrompt.more")}
        </Button>
      ) : null,
    [size, expanded, hidesContent, t, disclosureState, toggleExpanded],
  );
  const actions = useMemo(
    () => (
      <View style={styles.controls} testID="sticky-user-message-controls">
        <Button
          variant="ghost"
          size={size}
          accessibilityLabel={t("stickyPrompt.previous")}
          disabled={navigation.busy || navigation.previousDisabled}
          loading={navigation.busy}
          onPress={navigation.previous}
          leftIcon={ChevronUp}
          testID="sticky-user-message-previous"
        />
        <Button
          variant="ghost"
          size={size}
          accessibilityLabel={t("stickyPrompt.next")}
          disabled={navigation.busy || navigation.nextDisabled}
          onPress={navigation.next}
          leftIcon={ChevronDown}
          testID="sticky-user-message-next"
        />
      </View>
    ),
    [
      size,
      t,
      navigation.busy,
      navigation.previousDisabled,
      navigation.nextDisabled,
      navigation.previous,
      navigation.next,
    ],
  );
  return (
    <View style={clipStyle}>
      <View style={surfaceStyle} testID="sticky-user-message">
        {!expanded ? (
          <UserMessage
            serverId={serverId}
            client={client}
            onContentPress={navigation.busy ? undefined : revealMessage}
            contentAccessibilityLabel={t("stickyPrompt.goToMessage")}
            bubbleWidth={navigation.geometry?.width}
            hideTextAccessibility={navigation.sourceMounted && !expanded}
            message={message.text}
            images={message.images}
            attachments={message.attachments}
            timestamp={message.timestamp.getTime()}
            disableOuterSpacing
            navigationActions={actions}
            contentAction={disclosure}
            previewLines={previewLines}
            onPreviewOverflowChange={reportTextOverflow}
          />
        ) : (
          <ScrollView style={expandedScrollStyle} nestedScrollEnabled>
            <UserMessage
              serverId={serverId}
              client={client}
              onContentPress={navigation.busy ? undefined : revealMessage}
              contentAccessibilityLabel={t("stickyPrompt.goToMessage")}
              bubbleWidth={navigation.geometry?.width}
              hideTextAccessibility={navigation.sourceMounted && !expanded}
              message={message.text}
              images={message.images}
              attachments={message.attachments}
              timestamp={message.timestamp.getTime()}
              disableOuterSpacing
              navigationActions={actions}
              contentAction={disclosure}
            />
          </ScrollView>
        )}
        {(navigation.error || navigation.discoveryStatus === "limited") && (
          <View style={styles.row}>
            <Text accessibilityRole="alert" style={styles.text}>
              {t(
                navigation.discoveryStatus === "limited"
                  ? "stickyPrompt.moreHistory"
                  : "stickyPrompt.failed",
              )}
            </Text>
            <Button variant="ghost" size={size} onPress={navigation.retry}>
              {t("common.actions.retry")}
            </Button>
          </View>
        )}
      </View>
    </View>
  );
}

/** Keep discovery usable before a full prompt exists; an empty exhausted chat has no controls. */
export function PromptDiscoverySurface({
  navigation,
}: {
  navigation: ReturnType<typeof useStickyPrompt>;
}) {
  const { t } = useTranslation();
  const compact = useIsCompactFormFactor();
  const size = compact ? "md" : "sm";
  const status = navigation.discoveryStatus;
  if (
    !navigation.busy &&
    !navigation.error &&
    !(navigation.cancelled && !navigation.message) &&
    status !== "limited" &&
    status !== "exhausted"
  )
    return null;
  let label = t("common.loading");
  if (navigation.error) label = t("stickyPrompt.failed");
  else if (navigation.cancelled && !navigation.message) label = t("stickyPrompt.cancelled");
  else if (status === "limited") label = t("stickyPrompt.moreHistory");
  else if (status === "exhausted") label = t("stickyPrompt.none");
  return (
    <View style={styles.container} testID="sticky-user-message">
      <View style={styles.row}>
        <View style={styles.preview}>
          <Text
            style={styles.text}
            accessibilityRole={navigation.error ? "alert" : undefined}
            accessibilityLiveRegion="polite"
          >
            {label}
          </Text>
        </View>
        {navigation.busy && (
          <Button variant="ghost" size={size} onPress={navigation.cancel}>
            {t("common.actions.cancel")}
          </Button>
        )}
        {(navigation.error ||
          (navigation.cancelled && !navigation.message) ||
          status === "limited") && (
          <Button variant="ghost" size={size} onPress={navigation.retry}>
            {t("common.actions.retry")}
          </Button>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    backgroundColor: theme.colors.surface0,
    flexShrink: 0,
    paddingHorizontal: theme.spacing[2],
    paddingBottom: theme.spacing[2],
  },
  row: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1] },
  preview: { flex: 1, minWidth: 0 },
  controls: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end" },
  text: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
}));

/** Only this prompt's actual measured clipping or summarized attachments need disclosure. */
function hidesPromptPreviewContent(
  message: UserPrompt,
  overflow: { id: string; text: string; lines: number; hidden: boolean },
  lines: number,
): boolean {
  if ((message.images?.length ?? 0) + (message.attachments?.length ?? 0) > 0) return true;
  return (
    overflow.id === message.id &&
    overflow.text === message.text &&
    overflow.lines === lines &&
    overflow.hidden
  );
}
