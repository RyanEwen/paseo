import { useCallback, useContext, useMemo, useState, type ComponentProps } from "react";
import { View, type GestureResponderEvent } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { isWeb } from "@/constants/platform";
import { Button } from "@/components/ui/button";
import type { UserMessage } from "@/components/message";
import { ActualPinnedRowContext, ActualPromptRowsContext } from "./actual-prompt-rows";
import { PromptNavigationContext } from "./prompt-navigation-actions";
import { PinnedMessageActionBackdrop } from "./pinned-message-action-backdrop";

type MessageProps = ComponentProps<typeof UserMessage>;
type Presentation = Partial<
  Pick<
    MessageProps,
    | "copyMask"
    | "previewLines"
    | "previewExpanded"
    | "bodyViewportHeight"
    | "pinned"
    | "actionRowBackdrop"
    | "onPreviewOverflowChange"
    | "inlineContentAction"
    | "contentAction"
    | "onContentPress"
    | "contentAccessibilityLabel"
  >
>;

function selectedPromptText(event: GestureResponderEvent): boolean {
  if (!isWeb) return false;
  const selection = window.getSelection();
  const target: unknown = event.currentTarget;
  return (
    !!selection &&
    !selection.isCollapsed &&
    target instanceof HTMLElement &&
    (target.contains(selection.anchorNode) || target.contains(selection.focusNode))
  );
}

function usePromptDisclosure(id: string, props: MessageProps) {
  const rows = useContext(ActualPromptRowsContext);
  const { t } = useTranslation();
  const expanded = rows?.expandedIds.has(id) ?? false;
  const [overflow, setOverflow] = useState({ text: props.message, hidden: false });
  const report = useCallback(
    (hidden: boolean) =>
      setOverflow((current) =>
        current.text === props.message && current.hidden === hidden
          ? current
          : { text: props.message, hidden },
      ),
    [props.message],
  );
  const toggle = useCallback(() => rows?.toggleExpanded(id), [rows, id]);
  const disclosureState = useMemo(() => ({ expanded }), [expanded]);
  const attachments = (props.images?.length ?? 0) + (props.attachments?.length ?? 0);
  const hiddenText = overflow.text === props.message && overflow.hidden;
  const action = useMemo(
    () =>
      rows && (expanded || hiddenText || attachments > 0) ? (
        <Button
          variant="ghost"
          size="md"
          textStyle={styles.disclosureText}
          accessibilityLabel={t(expanded ? "stickyPrompt.collapse" : "stickyPrompt.expand")}
          accessibilityState={disclosureState}
          onPress={toggle}
          testID="user-message-disclosure"
        >
          {t(expanded ? "stickyPrompt.less" : "stickyPrompt.more")}
        </Button>
      ) : null,
    [rows, expanded, hiddenText, attachments, t, disclosureState, toggle],
  );
  return { expanded, report, action };
}

/** The shared renderer keeps the real body; this hook only supplies its policy. */
export function useActualPromptPresentation(id: string, props: MessageProps): Presentation {
  const rows = useContext(ActualPromptRowsContext);
  const pinned = useContext(ActualPinnedRowContext);
  const navigation = useContext(PromptNavigationContext);
  const disclosure = usePromptDisclosure(id, props);
  const { t } = useTranslation();
  const backdrop = useMemo(
    () => (pinned ? <PinnedMessageActionBackdrop /> : <View pointerEvents="none" />),
    [pinned],
  );
  const reveal = useCallback(
    (event: GestureResponderEvent) => {
      if (!selectedPromptText(event)) navigation?.reveal(id);
    },
    [navigation, id],
  );
  if (!rows) return {};
  return {
    copyMask: undefined,
    previewLines: 1,
    previewExpanded: disclosure.expanded,
    bodyViewportHeight: rows.availableHeight,
    pinned,
    actionRowBackdrop: backdrop,
    onPreviewOverflowChange: disclosure.report,
    inlineContentAction: disclosure.action,
    contentAction: undefined,
    onContentPress: pinned ? reveal : props.onContentPress,
    contentAccessibilityLabel: pinned
      ? t("stickyPrompt.goToMessage")
      : props.contentAccessibilityLabel,
  };
}

const styles = StyleSheet.create((theme) => ({
  disclosureText: { color: theme.colors.userMessageForeground },
}));
