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

/** One stable rail for all workspace names; the existing status/project gutter stays intact. */
export function WorkspaceProjectPinGutter({
  workspace,
}: {
  workspace: Pick<SidebarWorkspaceEntry, "workspaceKey" | "projectPinnedAt" | "pinnedAt">;
}) {
  const enabled = useContext(ProjectPinGutterContext);
  if (!enabled) return null;
  return (
    <View
      style={styles.rail}
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
  rail: {
    width: theme.iconSize.md,
    height: theme.iconSize.md + theme.spacing[1],
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    // The shared row already supplies spacing[2]; keep a small gap before the title column.
    marginRight: -theme.spacing[1],
  },
}));
