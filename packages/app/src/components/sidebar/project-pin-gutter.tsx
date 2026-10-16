import { createContext, useContext } from "react";
import { View } from "react-native";
import { Pin } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import type { Theme } from "@/styles/theme";

const ProjectPinGutterContext = createContext(false);
export const ProjectPinGutterProvider = ProjectPinGutterContext.Provider;
const PinIcon = withUnistyles(Pin);
const pinMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.sm,
});

/** Paint inside the existing leading gutter without participating in row layout. */
export function WorkspaceProjectPinGutter({
  workspace,
  occupied = false,
  outside = false,
}: {
  occupied?: boolean;
  outside?: boolean;
  workspace: Pick<SidebarWorkspaceEntry, "workspaceKey" | "projectPinnedAt" | "pinnedAt">;
}) {
  const enabled = useContext(ProjectPinGutterContext);
  if (!enabled || workspace.projectPinnedAt == null) return null;
  return (
    <View
      style={[styles.rail, occupied && styles.annotation, outside && styles.outside]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
      testID={`sidebar-project-pin-rail-${workspace.workspaceKey}`}
    >
      {workspace.projectPinnedAt != null ? (
        <View testID={`sidebar-project-pin-icon-${workspace.workspaceKey}`}>
          <PinIcon uniProps={pinMapping} />
        </View>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  annotation: {
    transform: [{ scale: 0.65 }],
    left: theme.iconSize.md / 2,
    top: theme.spacing[1],
  },
  outside: { left: -(theme.iconSize.md + theme.spacing[2]) },
  rail: {
    position: "absolute",
    left: 0,
    top: 0,
    width: theme.iconSize.md,
    height: theme.iconSize.md + theme.spacing[1],
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
}));
