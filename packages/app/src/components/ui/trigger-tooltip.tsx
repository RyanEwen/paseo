import type { ReactElement } from "react";
import { Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

/** Adds the shared picker tooltip while preserving the trigger's forwarded ref and events. */
export function TriggerTooltip({ children, label }: { children: ReactElement; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild triggerRefProp="ref">
        {children}
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <Text style={styles.text}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  text: { fontSize: theme.fontSize.base, color: theme.colors.popoverForeground },
}));
