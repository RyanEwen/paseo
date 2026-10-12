import { useAppSettings } from "@/hooks/use-settings";
import { useTranslation } from "react-i18next";
import { ChevronsUpDown, ChevronsDownUp } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Text, type PressableStateCallbackType } from "react-native";
import { iconButtonChromeStyle, mutedIconColorMapping } from "@/components/ui/icon-button-chrome";
import { useSidebarBulkCollapse } from "./use-sidebar-bulk-collapse";

const ExpandIcon = withUnistyles(ChevronsUpDown);
const CollapseIcon = withUnistyles(ChevronsDownUp);

/** Use the shared small toolbar hitbox and interaction fill for both desktop actions. */
function controlStyle(state: PressableStateCallbackType & { hovered?: boolean }) {
  return iconButtonChromeStyle({ size: "small", state });
}

/** Desktop Workspaces header controls; compact layouts expose these actions in Display. */
export function SidebarBulkCollapseControls() {
  const { settings } = useAppSettings();
  const { t } = useTranslation();
  const { expandAll, collapseAll } = useSidebarBulkCollapse();
  if (!settings.paseoPlusPlus.sidebarBulkActions) return null;
  return (
    <>
      <Tooltip delayDuration={300}>
        <TooltipTrigger
          onPress={expandAll}
          style={controlStyle}
          accessibilityRole="button"
          accessibilityLabel={t("sidebar.display.expandAll")}
          testID="sidebar-expand-all"
        >
          <ExpandIcon size={14} uniProps={mutedIconColorMapping} />
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <Text style={styles.label}>{t("sidebar.display.expandAll")}</Text>
        </TooltipContent>
      </Tooltip>
      <Tooltip delayDuration={300}>
        <TooltipTrigger
          onPress={collapseAll}
          style={controlStyle}
          accessibilityRole="button"
          accessibilityLabel={t("sidebar.display.collapseAll")}
          testID="sidebar-collapse-all"
        >
          <CollapseIcon size={14} uniProps={mutedIconColorMapping} />
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <Text style={styles.label}>{t("sidebar.display.collapseAll")}</Text>
        </TooltipContent>
      </Tooltip>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  label: { color: theme.colors.popoverForeground, fontSize: theme.fontSize.base },
}));
