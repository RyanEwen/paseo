import { HoverRevealActions } from "./hover-reveal-actions";
import { memo, useMemo, useCallback, useState, type ReactNode } from "react";
import { Text, View, type ViewStyle } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { CircleAlert, Folder, FolderGit2, Monitor } from "lucide-react-native";
import { ProjectStatusIndicator } from "@/components/sidebar/project-leading-visual";
import type { SidebarSurfaceBackdrop } from "@/styles/surface-backdrop";
import {
  WorkspaceMetaRow,
  type WorkspaceServiceSummary,
} from "@/components/sidebar/workspace-meta-row";
import { WorkspaceHoverCard } from "@/components/workspace-hover-card";
import type { HostBadgeModel } from "@/hosts/appearance";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import {
  hasSidebarWorkspaceTrailing,
  type SidebarWorkspaceTrailing,
} from "@/components/sidebar/workspace-trailing";
import { useAppSettings } from "@/hooks/use-settings";
import type { Theme } from "@/styles/theme";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { getStatusDotColor } from "@/utils/status-dot-color";
import {
  STATUS_INDICATOR_ALERT_SIZE,
  STATUS_INDICATOR_DOT_SIZE,
  STATUS_INDICATOR_FILLED_DOT_SIZE,
} from "@/utils/status-indicator-geometry";
import { shouldRenderSyncedStatusLoader } from "@/utils/status-loader";
import { StatusRing } from "@/components/status-ring";
import { resolveSidebarWorkspacePrimaryLabel } from "@/components/sidebar/sidebar-workspace-title";
import { useWorkspaceLabelDefinitions } from "@/workspace-labels";

const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const needsInputColorMapping = (theme: Theme) => ({
  color: theme.colors.surface0,
  fill: getStatusDotColor({ theme, bucket: "needs_input" }) ?? undefined,
});

const ThemedCircleAlert = withUnistyles(CircleAlert);
const ThemedMonitor = withUnistyles(Monitor);
const ThemedFolder = withUnistyles(Folder);
const ThemedFolderGit2 = withUnistyles(FolderGit2);

export function SidebarWorkspaceRowFrame({
  workspace,
  isDragging = false,
  children,
}: {
  workspace: SidebarWorkspaceEntry;
  isDragging?: boolean;
  children: (input: {
    isHovered: boolean;
    contextMenuOpen: boolean;
    onContextMenuOpenChange: (open: boolean) => void;
    hoverHandlers: { onPointerEnter: () => void; onPointerLeave: () => void };
  }) => ReactNode;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const handlePointerEnter = useCallback(() => {
    if (!contextMenuOpen) setIsHovered(true);
  }, [contextMenuOpen]);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const handleContextMenuOpenChange = useCallback((open: boolean) => {
    setContextMenuOpen(open);
    if (open) setIsHovered(false);
  }, []);
  const hoverHandlers = useMemo(
    () => ({ onPointerEnter: handlePointerEnter, onPointerLeave: handlePointerLeave }),
    [handlePointerEnter, handlePointerLeave],
  );

  return (
    <WorkspaceHoverCard
      workspace={workspace}
      prHint={workspace.prHint}
      isDragging={isDragging}
      disabled={contextMenuOpen}
    >
      {children({
        isHovered: isHovered && !contextMenuOpen && !isDragging,
        contextMenuOpen,
        onContextMenuOpenChange: handleContextMenuOpenChange,
        hoverHandlers,
      })}
    </WorkspaceHoverCard>
  );
}

export const SidebarWorkspaceRowContent = memo(function SidebarWorkspaceRowContent({
  workspace,
  hostBadge,
  leadingProjectName = null,
  leadingProjectIconDataUri = null,
  serviceSummary = null,
  backdrop,
  isHovered,
  isLoading,
  isCreating = false,
  shortcutNumber = null,
  showShortcutBadge = false,
  reserveIdleStatusIndicatorSpace = true,
  children,
}: {
  workspace: SidebarWorkspaceEntry;
  hostBadge?: HostBadgeModel | null;
  /** Hoisted rows use their project icon as the leading visual because no project row contains them. */
  leadingProjectName?: string | null;
  leadingProjectIconDataUri?: string | null;
  serviceSummary?: WorkspaceServiceSummary | null;
  /** The row's current background, so the project status badge can knock out of it. */
  backdrop: SidebarSurfaceBackdrop;
  isHovered: boolean;
  isLoading: boolean;
  isCreating?: boolean;
  shortcutNumber?: number | null;
  showShortcutBadge?: boolean;
  /** Keep the empty leading slot when the workspace has no active status. */
  reserveIdleStatusIndicatorSpace?: boolean;
  children?: ReactNode;
}) {
  const {
    settings: { workspaceTitleSource },
  } = useAppSettings();
  const workspaceLabel = resolveSidebarWorkspacePrimaryLabel({ workspace, workspaceTitleSource });
  // The workspace carries label names; their colors live in its host's catalog, so the row is
  // where the two meet — the meta line is handed finished definitions.
  const labels = useWorkspaceLabelDefinitions(workspace.serverId, workspace.labels);
  const workspaceBranchTextStyle = useMemo(
    () => [
      styles.workspaceBranchText,
      isHovered && styles.workspaceBranchTextHovered,
      isCreating && styles.workspaceBranchTextCreating,
    ],
    [isHovered, isCreating],
  );

  return (
    <View style={styles.workspaceRowContent}>
      <View style={styles.workspaceRowMain}>
        {leadingProjectName ? (
          <ProjectStatusIndicator
            iconDataUri={leadingProjectIconDataUri}
            displayName={leadingProjectName}
            projectViewKey={workspace.projectViewKey}
            statusBucket={null}
            backdrop={backdrop}
            loading={isLoading}
            testID={`sidebar-row-project-icon-${workspace.workspaceKey}`}
          />
        ) : (
          <WorkspaceLeadingStatusSpace
            workspace={workspace}
            loading={isLoading}
            reserveIdleSpace={reserveIdleStatusIndicatorSpace}
          />
        )}
        <View style={styles.workspaceContentColumn}>
          <View style={styles.workspaceTitleRow}>
            <Text style={workspaceBranchTextStyle} numberOfLines={1}>
              {workspaceLabel}
            </Text>
            <View style={sidebarWorkspaceRowStyles.rowRight}>{children}</View>
          </View>
          <WorkspaceMetaRow
            currentBranch={workspace.currentBranch}
            projectName={leadingProjectName}
            hostBadge={hostBadge ?? null}
            prHint={workspace.prHint}
            serviceSummary={serviceSummary}
            labels={labels}
          />
        </View>
      </View>
      {showShortcutBadge && shortcutNumber !== null ? (
        <View style={styles.shortcutBadgeOverlay} pointerEvents="none">
          <SidebarWorkspaceShortcutBadge number={shortcutNumber} />
        </View>
      ) : null}
    </View>
  );
});

/** Keep title indentation stable; operation loaders stay here while activity moves right. */
function WorkspaceLeadingStatusSpace({
  workspace,
  loading,
  reserveIdleSpace,
}: {
  workspace: SidebarWorkspaceEntry;
  loading: boolean;
  reserveIdleSpace: boolean;
}) {
  if (loading) {
    return (
      <WorkspaceStatusIndicator
        bucket={workspace.statusBucket}
        workspaceKind={workspace.workspaceKind}
        loading
      />
    );
  }
  return reserveIdleSpace ? <View style={styles.workspaceStatusDot} /> : null;
}

function WorkspaceStatusIndicator({
  bucket,
  workspaceKind,
  loading = false,
  reserveIdleSpace = true,
}: {
  bucket: SidebarWorkspaceEntry["statusBucket"];
  workspaceKind: SidebarWorkspaceEntry["workspaceKind"];
  loading?: boolean;
  reserveIdleSpace?: boolean;
}) {
  // Startup and archive loaders stay on the leading rail; working activity lives at the right.
  if (loading) {
    return (
      <View style={styles.workspaceStatusDot} testID="workspace-status-indicator-loading">
        <StatusRing />
      </View>
    );
  }

  if (shouldRenderSyncedStatusLoader({ bucket })) {
    return (
      <View style={styles.workspaceStatusDot} testID="workspace-status-indicator-running">
        <StatusRing />
      </View>
    );
  }

  if (bucket === "needs_input") {
    return (
      <View style={styles.workspaceStatusDot} testID="workspace-status-indicator-needs_input">
        <ThemedCircleAlert size={STATUS_INDICATOR_ALERT_SIZE} uniProps={needsInputColorMapping} />
      </View>
    );
  }

  if (bucket === "attention") {
    return (
      <View style={styles.workspaceStatusDot} testID="workspace-status-indicator-attention">
        <View style={styles.standaloneStatusDot} />
      </View>
    );
  }

  if (bucket === "done") {
    // Keep a quiet idle mark on the trailing rail so activity changes preserve its geometry.
    return reserveIdleSpace ? (
      <View style={styles.workspaceStatusDot} testID="workspace-status-indicator-done">
        <View style={styles.idleStatusDot} />
      </View>
    ) : null;
  }

  let KindIcon: typeof ThemedMonitor;
  if (workspaceKind === "local_checkout") KindIcon = ThemedMonitor;
  else if (workspaceKind === "worktree") KindIcon = ThemedFolderGit2;
  else KindIcon = ThemedFolder;

  const dotColorStyle = getStatusDotColorStyle(bucket);
  return (
    <View style={styles.workspaceStatusDot} testID={`workspace-status-indicator-${bucket}`}>
      <KindIcon size={14} uniProps={foregroundMutedColorMapping} />
      {dotColorStyle ? <StatusDotOverlay dotColorStyle={dotColorStyle} /> : null}
    </View>
  );
}

function StatusDotOverlay({ dotColorStyle }: { dotColorStyle: ViewStyle }) {
  return <View style={[styles.statusDotOverlay, dotColorStyle]} />;
}

function getStatusDotColorStyle(bucket: SidebarStateBucket) {
  switch (bucket) {
    case "needs_input":
      return styles.statusDotNeedsInput;
    case "failed":
      return styles.statusDotFailed;
    case "running":
      return styles.statusDotRunning;
    case "attention":
      return styles.statusDotAttention;
    case "done":
      return null;
  }
}

export const sidebarWorkspaceRowStyles = StyleSheet.create((theme) => ({
  // How far a workspace row sits inside the group header above it — a project row or a
  // status group header. Both groupings share this one indent, so every grouped workspace row
  // in the sidebar sits on the same rail regardless of how the list is grouped. Pinned rows
  // are not grouped and stay flush.
  //
  // It is row padding rather than a margin on the list, because the row's hover and selected
  // backgrounds have to keep spanning the group's full width. Indenting the container instead
  // pulls the highlight in with the content and the row stops lining up with its header.
  rowIndented: {
    paddingLeft: theme.spacing[2] + theme.spacing[2],
  },
  rowRight: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    flexShrink: 0,
  },
  shortcutBadge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: theme.spacing[1],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.surface2,
    backgroundColor: theme.colors.surface0,
    flexShrink: 0,
  },
  shortcutBadgeText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    lineHeight: 14,
  },
  hidden: { opacity: 0 },
  // Metadata and status share this frame; revealed actions reserve their own animated width.
  trailingActionSlot: {
    position: "relative",
    minHeight: 20,
    flexShrink: 0,
    alignItems: "flex-end",
    justifyContent: "flex-start",
  },
  trailingActionSlotReserved: {
    position: "relative",
    minWidth: 18,
    minHeight: 20,
    flexShrink: 0,
    alignItems: "flex-end",
    justifyContent: "flex-start",
  },
}));

export function SidebarWorkspaceShortcutBadge({ number }: { number: number }) {
  return (
    <View style={sidebarWorkspaceRowStyles.shortcutBadge}>
      <Text style={sidebarWorkspaceRowStyles.shortcutBadgeText}>{number}</Text>
    </View>
  );
}

export type SidebarWorkspaceTrailingPresentation = "visible" | "hidden" | "absent";

/**
 * Shared metadata and menu policy for every workspace row renderer.
 * Desktop metadata stays beside the status and revealed actions; touch keeps the menu visible
 * and replaces the metadata. Shortcut hints temporarily conceal metadata without changing width.
 */
export function resolveTrailingActionVisibility({
  workspace,
  trailing,
  hasArchiveAction,
  isHovered,
  isTouchPlatform,
  showShortcut,
}: {
  workspace: SidebarWorkspaceEntry;
  trailing: SidebarWorkspaceTrailing;
  hasArchiveAction: boolean;
  isHovered: boolean;
  isTouchPlatform: boolean;
  showShortcut: boolean;
}): {
  trailingPresentation: SidebarWorkspaceTrailingPresentation;
  showKebab: boolean;
  renderSlot: boolean;
  reserveSlotWidth: boolean;
} {
  const hasTrailing = hasSidebarWorkspaceTrailing({ workspace, trailing });
  const showKebab = Boolean(hasArchiveAction && (isHovered || isTouchPlatform)) && !showShortcut;
  // Touch permanently replaces the stats with the menu. Only temporary shortcut hints
  // conceal content while retaining its width, so desktop rows do not shift.
  const hasContent = hasTrailing && !(hasArchiveAction && isTouchPlatform);
  let trailingPresentation: SidebarWorkspaceTrailingPresentation = "absent";
  if (hasContent) trailingPresentation = showShortcut ? "hidden" : "visible";
  return {
    trailingPresentation,
    showKebab,
    renderSlot: true,
    // Metadata reserves its own width; the status and actions lay out alongside it.
    reserveSlotWidth: hasContent || (hasArchiveAction && isTouchPlatform),
  };
}

export function SidebarWorkspaceTrailingActionSlot({
  reserveWidth,
  children,
}: {
  reserveWidth: boolean;
  children: ReactNode;
}) {
  return (
    <View
      style={[
        reserveWidth
          ? sidebarWorkspaceRowStyles.trailingActionSlotReserved
          : sidebarWorkspaceRowStyles.trailingActionSlot,
        styles.trailingContentRow,
      ]}
    >
      {children}
    </View>
  );
}

export function SidebarWorkspaceTrailingActionBase({
  presentation,
  children,
}: {
  presentation: SidebarWorkspaceTrailingPresentation;
  children: ReactNode;
}) {
  if (presentation === "absent") return null;
  return (
    <View style={presentation === "hidden" ? sidebarWorkspaceRowStyles.hidden : undefined}>
      {children}
    </View>
  );
}

/** Keep every status at the trailing rail and slide it aside for hover or persistent menus. */
export function SidebarWorkspaceTrailingStatusActions({
  workspace,
  visible,
  children,
}: {
  workspace: SidebarWorkspaceEntry;
  visible: boolean;
  children: ReactNode;
}) {
  return (
    <View style={styles.workspaceStatusActionsFrame}>
      <View style={[styles.trailingContentRow, styles.workspaceStatusActionsContent]}>
        <WorkspaceStatusIndicator
          bucket={workspace.statusBucket}
          workspaceKind={workspace.workspaceKind}
        />
        <HoverRevealActions
          visible={visible}
          width={18}
          height={20}
          testID={`sidebar-workspace-hover-actions-${workspace.workspaceKey}`}
        >
          {children}
        </HoverRevealActions>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Reserve the complete revealed footprint so the 100ms internal movement never steals
  // title width. The right anchor keeps idle status and visible actions on the same rail.
  workspaceStatusActionsFrame: {
    position: "relative",
    width: theme.iconSize.md + theme.spacing[2] + 18,
    height: 20,
    flexShrink: 0,
  },
  workspaceStatusActionsContent: {
    position: "absolute",
    top: 0,
    right: 0,
  },
  trailingContentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  workspaceRowContent: {
    position: "relative",
  },
  workspaceRowMain: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    width: "100%",
  },
  workspaceContentColumn: {
    flex: 1,
    minWidth: 0,
  },
  workspaceTitleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  shortcutBadgeOverlay: {
    position: "absolute",
    top: 1,
    right: 0,
  },
  workspaceStatusDot: {
    position: "relative",
    width: theme.iconSize.md,
    height: 20,
    borderRadius: theme.borderRadius.full,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  statusDotOverlay: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: STATUS_INDICATOR_DOT_SIZE,
    height: STATUS_INDICATOR_DOT_SIZE,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
  },
  standaloneStatusDot: {
    width: STATUS_INDICATOR_FILLED_DOT_SIZE,
    height: STATUS_INDICATOR_FILLED_DOT_SIZE,
    borderRadius: theme.borderRadius.full,
    backgroundColor: getStatusDotColor({ theme, bucket: "attention" }) ?? undefined,
  },
  idleStatusDot: {
    width: STATUS_INDICATOR_FILLED_DOT_SIZE,
    height: STATUS_INDICATOR_FILLED_DOT_SIZE,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.foregroundExtraMuted,
    opacity: 0.3,
  },
  // The title owns the first line outright now that the host, change request and CI moved
  // to the meta row, so it takes the full width the trailing slot leaves behind.
  workspaceBranchText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: "400",
    lineHeight: 20,
    opacity: 0.76,
    flex: 1,
    minWidth: 0,
  },
  workspaceBranchTextCreating: {
    opacity: 0.92,
  },
  workspaceBranchTextHovered: {
    opacity: 1,
  },
  statusDotNeedsInput: {
    backgroundColor: getStatusDotColor({ theme, bucket: "needs_input" }) ?? undefined,
    borderColor: theme.colors.surface0,
  },
  statusDotFailed: {
    backgroundColor: getStatusDotColor({ theme, bucket: "failed" }) ?? undefined,
    borderColor: theme.colors.surface0,
  },
  statusDotRunning: {
    backgroundColor: getStatusDotColor({ theme, bucket: "running" }) ?? undefined,
    borderColor: theme.colors.surface0,
  },
  statusDotAttention: {
    backgroundColor: getStatusDotColor({ theme, bucket: "attention" }) ?? undefined,
    borderColor: theme.colors.surface0,
  },
}));
