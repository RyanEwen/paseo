import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { UserMessage } from "@/components/message";

/** Preview the actual message renderer, with no timestamp or conversation actions. */
export function AccentPreview({ message }: { message: string }) {
  return (
    <View style={styles.container} testID="accent-message-preview">
      <UserMessage message={message} timestamp={0} previewLines={3} disableOuterSpacing />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[4],
  },
}));
