import { useCallback, useMemo, type ReactElement } from "react";
import { StyleSheet } from "react-native-unistyles";
import { MenuItem } from "@/components/ui/menu";
import { ProjectIconView } from "@/components/project-icon-view";
import { projectIconPlaceholderLabelFromDisplayName } from "@/utils/project-display-name";

/** A project option shared by the sidebar selector and legacy multi-select filter. */
export function SidebarProjectMenuItem({
  viewKey,
  label,
  iconDataUri,
  selected,
  onSelect,
  closeOnSelect = true,
  testID,
}: {
  viewKey: string;
  label: string;
  iconDataUri: string | null;
  selected: boolean;
  onSelect: (viewKey: string) => void;
  closeOnSelect?: boolean;
  testID: string;
}): ReactElement {
  const handleSelect = useCallback(() => onSelect(viewKey), [viewKey, onSelect]);
  const leading = useMemo(
    () => (
      <ProjectIconView
        iconDataUri={iconDataUri}
        initial={projectIconPlaceholderLabelFromDisplayName(label).charAt(0).toUpperCase()}
        projectViewKey={viewKey}
        size={14}
        textStyle={styles.projectIconText}
      />
    ),
    [iconDataUri, label, viewKey],
  );

  return (
    <MenuItem
      selected={selected}
      leading={leading}
      closeOnSelect={closeOnSelect}
      onSelect={handleSelect}
      testID={testID}
    >
      {label}
    </MenuItem>
  );
}

const styles = StyleSheet.create({
  // Match the existing 14pt menu icon slot rather than the sidebar row's larger initial.
  projectIconText: { fontSize: 8 },
});
