import { createContext, useContext } from "react";
import { ChevronDown, ChevronUp } from "lucide-react-native";
import { useStableEvent } from "@/hooks/use-stable-event";
import { StyleSheet } from "react-native-unistyles";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useIsCompactFormFactor } from "@/constants/layout";
import type { PromptNavigationControls } from "./use-prompt-navigation-controls";

export const PromptNavigationContext = createContext<PromptNavigationControls | null>(null);

/** Keep navigation on the original bubble while its sticky copy is hidden. */
export function PromptNavigationActions({ messageId }: { messageId: string }) {
  const navigation = useContext(PromptNavigationContext);
  const { t } = useTranslation();
  const compact = useIsCompactFormFactor();
  const previous = useStableEvent(() => navigation?.activate(messageId, -1));
  const next = useStableEvent(() => navigation?.activate(messageId, 1));
  if (!navigation) return null;
  const position = navigation.targetIds.indexOf(messageId);
  if (position < 0) return null;
  const size = compact ? "md" : "sm";
  return (
    <View style={styles.row}>
      <Button
        variant="ghost"
        size={size}
        leftIcon={ChevronUp}
        accessibilityLabel={t("stickyPrompt.previous")}
        disabled={navigation.busy || (position === 0 && navigation.previousKnownBoundary)}
        onPress={previous}
        testID="user-message-previous"
      />
      <Button
        variant="ghost"
        size={size}
        leftIcon={ChevronDown}
        accessibilityLabel={t("stickyPrompt.next")}
        disabled={navigation.busy || position === navigation.targetIds.length - 1}
        onPress={next}
        testID="user-message-next"
      />
    </View>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: "row" } });
