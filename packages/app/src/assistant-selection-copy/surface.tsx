import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle, type ViewProps } from "react-native";

interface AssistantSelectionCopySurfaceProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onLayout?: ViewProps["onLayout"];
}

export function AssistantSelectionCopySurface({
  children,
  style,
  onLayout,
}: AssistantSelectionCopySurfaceProps) {
  return (
    <View style={style} onLayout={onLayout}>
      {children}
    </View>
  );
}
