import { useMemo, type ReactNode } from "react";
import { ScrollView } from "@/components/ui/scroll-view";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { CONTROL_HEIGHTS } from "@/components/ui/control-geometry";

/** Keep one body ancestry in both disclosure states. The capped parent column
 * reserves its real padding/action height; the body alone may shrink and scroll.
 */
export function UserMessagePreviewContent({
  children,
  action,
  attachments,
  compact = false,
  hasText,
  bounded = false,
}: {
  children: ReactNode;
  action?: ReactNode;
  attachments?: ReactNode;
  compact?: boolean;
  hasText: boolean;
  bounded?: boolean;
}) {
  const contentStyle = useMemo(() => {
    if (compact) return [styles.text, styles.previewText];
    return [styles.text, bounded ? styles.expandedText : undefined];
  }, [bounded, compact]);
  const rowStyle = useMemo(() => [styles.row, bounded ? styles.bounded : undefined], [bounded]);
  const dataSet = useMemo(() => ({ bodyExpanded: String(!compact) }), [compact]);
  const body = (
    <View style={contentStyle}>
      {attachments}
      <View style={compact ? styles.content : styles.fullContent}>{hasText && children}</View>
    </View>
  );
  return (
    <View style={rowStyle}>
      {
        <ScrollView
          style={styles.bodyViewport}
          scrollEnabled={bounded && !compact}
          nestedScrollEnabled={bounded && !compact}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={bounded && !compact}
          testID="user-message-body-scroll"
          dataSet={dataSet}
        >
          {body}
        </ScrollView>
      }

      {action ? (
        <View style={styles.action} pointerEvents="box-none">
          {action}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: { flexDirection: "row", alignItems: "stretch", gap: theme.spacing[2], minHeight: 0 },
  bounded: { flexShrink: 1 },
  text: { flexGrow: 1, flexShrink: 1, flexBasis: "auto", minWidth: 0 },
  content: { flex: 1, minWidth: 0 },
  fullContent: { minWidth: 0 },
  bodyViewport: { flexGrow: 1, flexShrink: 1, flexBasis: "auto", minWidth: 0, minHeight: 0 },
  expandedText: { paddingVertical: theme.spacing[4] },
  previewText: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[4],
    minHeight: Math.round(theme.fontSize.content * 1.4) + theme.spacing[4] * 2,
  },
  action: {
    minHeight: CONTROL_HEIGHTS.field,
    justifyContent: "center",
    alignSelf: "center",
    flexShrink: 0,
  },
}));
