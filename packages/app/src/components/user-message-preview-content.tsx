import type { ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { CONTROL_HEIGHTS } from "@/components/ui/control-geometry";

/** Reserve a trailing disclosure column so the preview never paints underneath it.
 * Compact text owns the bubble's existing vertical padding. Its full one-line cell
 * contains the disclosure's 44-pixel touch parent, so adding disclosure cannot move
 * navigation below the bubble. Full original and expanded content keep their padding.
 */
export function UserMessagePreviewContent({
  children,
  action,
  attachments,
  compact = false,
  hasText,
}: {
  children: ReactNode;
  action?: ReactNode;
  attachments?: ReactNode;
  compact?: boolean;
  hasText: boolean;
}) {
  return (
    <>
      {!compact && attachments}
      <View style={styles.row}>
        <View style={[styles.text, compact ? styles.previewText : undefined]}>
          {compact && attachments}
          {compact ? hasText && <View style={styles.content}>{children}</View> : children}
        </View>
        {action ? (
          <View style={styles.action} pointerEvents="box-none">
            {action}
          </View>
        ) : null}
      </View>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  // A shrink-wrapped bubble needs the text's intrinsic basis before it has a width.
  // Native Yoga resolves flex: 1 to a zero basis and can leave only bubble padding.
  text: { flexGrow: 1, flexShrink: 1, flexBasis: "auto", minWidth: 0 },
  content: { flex: 1, minWidth: 0 },
  previewText: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[4],
    // Attachment-only previews still occupy the same single content line.
    minHeight: Math.round(theme.fontSize.content * 1.4) + theme.spacing[4] * 2,
  },
  action: { height: CONTROL_HEIGHTS.field, justifyContent: "center" },
}));
