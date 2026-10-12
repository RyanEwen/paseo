import { useMemo, useState } from "react";
import { ScrollView, Text, View, useWindowDimensions } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useStableEvent } from "@/hooks/use-stable-event";
import { ChevronDown, ChevronUp, Plus, Minus } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { UserMessage } from "@/components/message";
import { useIsCompactFormFactor } from "@/constants/layout";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useStickyPrompt } from "./use-sticky-prompt";

type Props = Parameters<typeof useStickyPrompt>[0] & {
  serverId: string;
  client: DaemonClient | null;
  followLatestRevision: number;
  availableHeight: number;
};

/** A measured sibling of the timeline, so its content stays visible on every platform. */
export function StickyPrompt({
  serverId,
  client,
  followLatestRevision,
  availableHeight,
  ...input
}: Props) {
  const { t } = useTranslation();
  const navigation = useStickyPrompt(input);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [lastFollowRevision, setLastFollowRevision] = useState(followLatestRevision);
  const compact = useIsCompactFormFactor();
  const { height } = useWindowDimensions();
  if (lastFollowRevision !== followLatestRevision) {
    setLastFollowRevision(followLatestRevision);
    navigation.followLatest();
  }
  const message = navigation.message;
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
  if (!message) return null;
  const attachmentCount = countAttachments(message);
  const size = compact ? "md" : "sm";
  return (
    <View style={styles.container} testID="sticky-user-message">
      <View style={styles.row}>
        <View style={styles.preview}>
          <Text style={styles.label}>
            {navigation.nextDisabled ? t("stickyPrompt.latest") : t("stickyPrompt.selected")}
          </Text>
          {!expanded && (
            <Text numberOfLines={2} style={styles.text}>
              {message.text}
            </Text>
          )}
          {!expanded && attachmentCount > 0 && (
            <Text style={styles.label}>
              {t("stickyPrompt.attachments", { count: attachmentCount })}
            </Text>
          )}
        </View>
        <Button
          variant="ghost"
          size={size}
          accessibilityLabel={expanded ? t("stickyPrompt.collapse") : t("stickyPrompt.expand")}
          accessibilityState={disclosureState}
          onPress={toggleExpanded}
          testID="sticky-user-message-disclosure"
          leftIcon={expanded ? Minus : Plus}
        />
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
      {navigation.error && (
        <View style={styles.row}>
          <Text accessibilityRole="alert" style={styles.text}>
            {t("stickyPrompt.failed")}
          </Text>
          <Button
            variant="ghost"
            size={size}
            onPress={input.outline.indexError ? input.outline.retryIndex : navigation.retry}
          >
            {t("common.actions.retry")}
          </Button>
        </View>
      )}
      {expanded && (
        <ScrollView style={expandedScrollStyle} nestedScrollEnabled>
          <UserMessage
            serverId={serverId}
            client={client}
            message={message.text}
            images={message.images}
            attachments={message.attachments}
            timestamp={message.timestamp.getTime()}
            disableOuterSpacing
          />
        </ScrollView>
      )}
    </View>
  );
}

function countAttachments(
  message: NonNullable<ReturnType<typeof useStickyPrompt>["message"]>,
): number {
  return (message.images?.length ?? 0) + (message.attachments?.length ?? 0);
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flexShrink: 0,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  row: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1] },
  preview: { flex: 1, minWidth: 0 },
  label: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  text: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
}));
