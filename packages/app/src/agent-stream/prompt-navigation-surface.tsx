import { useMemo } from "react";
import { Text, View, ScrollView, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, Plus, Minus } from "lucide-react-native";
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
  const surfaceStyle = useMemo(
    () => [styles.container, { opacity: navigation.stickyProgress }],
    [navigation.stickyProgress],
  );
  return (
    <View style={surfaceStyle} testID="sticky-user-message">
      {!expanded ? (
        <UserMessage
          serverId={serverId}
          client={client}
          message={message.text}
          images={message.images}
          attachments={message.attachments}
          timestamp={message.timestamp.getTime()}
          disableOuterSpacing
          previewLines={2}
        />
      ) : (
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
      <View style={styles.controls} testID="sticky-user-message-controls">
        <Text style={styles.label}>
          {navigation.nextDisabled ? t("stickyPrompt.latest") : t("stickyPrompt.selected")}
        </Text>
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
          <Text style={styles.label}>{t("stickyPrompt.latest")}</Text>
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
  label: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  text: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
}));
