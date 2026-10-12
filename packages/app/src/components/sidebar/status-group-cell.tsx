import type { ReactNode } from "react";
import { View } from "react-native";

interface StatusGroupCellProps {
  workspaceKey: string;
  groupKey: string;
  resolveDestinationGroupKey: (workspaceKey: string) => string | undefined;
  children: ReactNode;
}

/** Preserve the native cell subtree without adding another gesture or focus owner. */
export function StatusGroupCell({ groupKey, children }: StatusGroupCellProps) {
  return <View testID={`sidebar-status-group-rows-${groupKey}`}>{children}</View>;
}
