import { useMemo } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { StatusRing } from "@/components/status-ring";
import { StatusBadge, type StatusBadgeVariant } from "@/components/ui/status-badge";
import { getStatusBucketLabel } from "@/hooks/sidebar-status-view-model";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";

/** Render the canonical aggregate label without competing with the project title. */
export function ProjectActivityChip({
  bucket,
  workingWorkspaceCount,
  projectViewKey,
  testID = `sidebar-project-status-${projectViewKey}`,
  spinnerTestID = `sidebar-project-working-spinner-${projectViewKey}`,
}: {
  bucket: SidebarStateBucket | null;
  workingWorkspaceCount: number;
  projectViewKey: string;
  testID?: string;
  spinnerTestID?: string;
}) {
  const { t } = useTranslation();
  const leading = useMemo(() => {
    if (bucket !== "running") return undefined;
    return (
      <View testID={spinnerTestID}>
        <StatusRing />
      </View>
    );
  }, [bucket, spinnerTestID]);
  if (!bucket) return null;
  let variant: StatusBadgeVariant = "muted";
  if (bucket === "failed") variant = "error";
  if (bucket === "needs_input") variant = "warning";
  if (bucket === "attention") variant = "success";
  if (bucket === "running") variant = "info";
  let label = getStatusBucketLabel(bucket, t);
  if (bucket === "running" && workingWorkspaceCount > 1) {
    label = t("sidebar.statusBucket.workingCount", { count: workingWorkspaceCount });
  }
  return (
    <View style={styles.projectStatusChip} testID={testID}>
      <StatusBadge label={label} size="xs" variant={variant} leading={leading} />
    </View>
  );
}

const styles = StyleSheet.create({ projectStatusChip: { flexShrink: 0 } });
