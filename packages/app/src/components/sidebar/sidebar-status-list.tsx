import { useSidebarRecencyClock } from "./workspace-recency-clock";
import { useSidebarOrderStore } from "@/stores/sidebar-order-store";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import { mergeWithRemainder, hasVisibleOrderChanged } from "@/utils/sidebar-reorder";
import { SidebarEmptyProjectGroup, SidebarWorkspaceGroupHeader } from "./sidebar-workspace-group";
import {
  memo,
  useCallback,
  useMemo,
  useState,
  useRef,
  type MutableRefObject,
  type ReactNode,
  type Ref,
} from "react";
import { useTranslation } from "react-i18next";
import { View, ScrollView, type GestureResponderEvent } from "react-native";
import { NestableScrollContainer } from "react-native-draggable-flatlist";
import type { GestureType } from "react-native-gesture-handler";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { type SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import type { SidebarWorkspaceGroup } from "@/components/sidebar/sidebar-labels";
import { SidebarFilterEmptyState } from "@/components/sidebar/empty-states";
import type { HostBadgeModel } from "@/hosts/appearance";
import { isNative as platformIsNative } from "@/constants/platform";
import { useIsCompactFormFactor } from "@/constants/layout";
import { StyleSheet } from "react-native-unistyles";
import { useToast } from "@/contexts/toast-context";
import { SidebarWorkspaceRename, useSidebarWorkspaceRename } from "./workspace-rename";
import { StatusGroupCell } from "./status-group-cell";
import { useWorkspaceClipboardActions } from "@/hooks/use-workspace-clipboard-actions";
import { redirectIfArchivingActiveWorkspace } from "@/utils/sidebar-workspace-archive-redirect";
import { useWorkspaceArchive } from "@/workspace/use-workspace-archive";
import { toWorktreeArchiveRisk } from "@/git/worktree-archive-warning";
import type { ShortcutKey } from "@/utils/format-shortcut";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import { useWorkspaceReadState } from "@/hooks/use-workspace-read-state";
import {
  SidebarWorkspaceRowFrame,
  SidebarWorkspaceRowContent,
  resolveTrailingActionVisibility,
  type SidebarWorkspaceTrailingPresentation,
  SidebarWorkspaceTrailingActionBase,
  SidebarWorkspaceTrailingStatusActions,
  SidebarWorkspaceTrailingActionSlot,
  sidebarWorkspaceRowStyles,
} from "@/components/sidebar/sidebar-workspace-row-content";
import { useOpenKebabMenuVisibility } from "@/components/sidebar/use-open-kebab-menu-visibility";
import { getSidebarRowBackdrop } from "@/components/sidebar/sidebar-row-backdrop";
import { selectWorkspaceServiceSummary } from "@/components/sidebar/workspace-meta-row";
import {
  SidebarWorkspaceTrailingContent,
  useSidebarWorkspaceTrailing,
  type SidebarWorkspaceTrailing,
} from "@/components/sidebar/workspace-trailing";
import { useSidebarCollapsedSectionsStore } from "@/stores/sidebar-collapsed-sections-store";
import {
  SidebarWorkspaceContextMenu,
  SidebarWorkspaceMenu,
} from "@/components/sidebar/sidebar-workspace-menu";
import { PinnedSectionHeader } from "@/components/sidebar/pinned-section-header";
import { SidebarGroupToggleRow } from "@/components/sidebar/sidebar-group-toggle-row";
import { useLimitedSidebarGroup } from "@/components/sidebar/use-limited-sidebar-group";
import type { ToggleSidebarWorkspacePin } from "@/hooks/use-sidebar-workspace-pin";
import { DraggableList, type DraggableRenderItemInfo } from "@/components/draggable-list";
import type { DraggableListDragHandleProps } from "@/components/draggable-list.types";
import { useSidebarPositionTransitionDuration } from "./position-transitions";
import {
  buildStatusListItems,
  statusListItemKey,
  statusListDragGroupKey,
  type StatusListItem,
} from "./status-list-items";
import { isDragGroupOrderValid } from "@/components/drag-reorder/reorder-items";
import { useLongPressDragInteraction } from "@/components/sidebar/use-long-press-drag-interaction";

const EMPTY_SHORTCUT_INDEX = new Map<string, number>();
const getStatusEnteredAt = (workspace: SidebarWorkspaceEntry) => workspace.statusEnteredAt;

function statusWorkspaceKeyExtractor(workspace: SidebarWorkspaceEntry): string {
  return workspace.workspaceKey;
}

interface StatusWorkspaceListProps {
  groups: SidebarWorkspaceGroup[];
  pinnedWorkspaces: SidebarWorkspaceEntry[];
  projectIconByProjectViewKey: ReadonlyMap<string, string | null>;
  shortcutIndexByWorkspaceKey: Map<string, number>;
  showShortcutBadges: boolean;
  onWorkspacePress?: () => void;
  hostBadgeByServerId: ReadonlyMap<string, HostBadgeModel>;
  supportsPinningByServerId: ReadonlyMap<string, boolean>;
  onToggleWorkspacePin: ToggleSidebarWorkspacePin;
  onPinnedWorkspaceReorder: (workspaces: SidebarWorkspaceEntry[]) => void;
  listHeaderComponent?: ReactNode;
  emptyProjectContent?: ReactNode;
  /** Swaps the group list for the label filter's empty state. Never the header above it. */
  sidebarFilterEmpty?: boolean;
  parentGestureRef?: MutableRefObject<GestureType | undefined>;
  dragGestureHostActive?: boolean;
}

export function SidebarStatusWorkspaceList({
  groups,
  pinnedWorkspaces,
  projectIconByProjectViewKey,
  shortcutIndexByWorkspaceKey,
  showShortcutBadges,
  onWorkspacePress,
  hostBadgeByServerId,
  supportsPinningByServerId,
  onToggleWorkspacePin,
  onPinnedWorkspaceReorder,
  listHeaderComponent,
  emptyProjectContent,
  sidebarFilterEmpty = false,
  parentGestureRef,
  dragGestureHostActive,
}: StatusWorkspaceListProps) {
  const collapsedWorkspaceGroupKeys = useSidebarCollapsedSectionsStore(
    (state) => state.collapsedWorkspaceGroupKeys,
  );
  const pinnedCollapsed = useSidebarCollapsedSectionsStore((state) => state.collapsedPinned);
  const togglePinnedCollapsed = useSidebarCollapsedSectionsStore(
    (state) => state.togglePinnedCollapsed,
  );
  const {
    visibleItems: visiblePinnedWorkspaces,
    expanded: pinnedWorkspacesExpanded,
    canToggle: canTogglePinnedWorkspaces,
    toggleExpanded: togglePinnedWorkspacesExpanded,
  } = useLimitedSidebarGroup(pinnedWorkspaces, getStatusEnteredAt);

  const statusShortcutIndex = showShortcutBadges
    ? shortcutIndexByWorkspaceKey
    : EMPTY_SHORTCUT_INDEX;
  const renderPinnedWorkspace = useCallback(
    ({
      item: workspace,
      drag,
      isActive,
      dragHandleProps,
    }: DraggableRenderItemInfo<SidebarWorkspaceEntry>) => (
      <StatusWorkspaceRow
        workspace={workspace}
        {...buildStatusRowProjectPresentation({
          workspace,
          projectIconByProjectViewKey,
          hostBadgeByServerId,
        })}
        inStatusGroup={false}
        shortcutNumber={statusShortcutIndex.get(workspace.workspaceKey) ?? null}
        showShortcutBadge={showShortcutBadges}
        canPin={supportsPinningByServerId.get(workspace.serverId) === true}
        onToggleWorkspacePin={onToggleWorkspacePin}
        onWorkspacePress={onWorkspacePress}
        drag={drag}
        isDragging={isActive}
        dragHandleProps={dragHandleProps}
      />
    ),
    [
      hostBadgeByServerId,
      onToggleWorkspacePin,
      onWorkspacePress,
      projectIconByProjectViewKey,
      showShortcutBadges,
      statusShortcutIndex,
      supportsPinningByServerId,
    ],
  );
  const content = (
    <>
      {pinnedWorkspaces.length > 0 ? (
        <View style={styles.pinnedSection} testID="sidebar-pinned-section">
          <PinnedSectionHeader collapsed={pinnedCollapsed} onToggle={togglePinnedCollapsed} />
          {pinnedCollapsed ? null : (
            <>
              <DraggableList
                testID="sidebar-pinned-list"
                data={visiblePinnedWorkspaces}
                keyExtractor={statusWorkspaceKeyExtractor}
                renderItem={renderPinnedWorkspace}
                onDragEnd={onPinnedWorkspaceReorder}
                scrollEnabled={false}
                useDragHandle
                nestable={platformIsNative}
                simultaneousGestureRef={parentGestureRef}
                gestureHostPresented={dragGestureHostActive}
              />
              {canTogglePinnedWorkspaces ? (
                <SidebarGroupToggleRow
                  expanded={pinnedWorkspacesExpanded}
                  onPress={togglePinnedWorkspacesExpanded}
                  testID="sidebar-pinned-show-more"
                />
              ) : null}
            </>
          )}
        </View>
      ) : null}
      {listHeaderComponent}
      {sidebarFilterEmpty ? (
        <SidebarFilterEmptyState />
      ) : (
        <StatusGroupList
          parentGestureRef={parentGestureRef}
          dragGestureHostActive={dragGestureHostActive}
          groups={groups}
          collapsedWorkspaceGroupKeys={collapsedWorkspaceGroupKeys}
          projectIconByProjectViewKey={projectIconByProjectViewKey}
          shortcutIndex={statusShortcutIndex}
          showShortcutBadges={showShortcutBadges}
          onWorkspacePress={onWorkspacePress}
          hostBadgeByServerId={hostBadgeByServerId}
          supportsPinningByServerId={supportsPinningByServerId}
          onToggleWorkspacePin={onToggleWorkspacePin}
        />
      )}
      {!sidebarFilterEmpty && emptyProjectContent ? (
        <SidebarEmptyProjectGroup>{emptyProjectContent}</SidebarEmptyProjectGroup>
      ) : null}
    </>
  );

  return (
    <SidebarWorkspaceRename>
      <View style={styles.container}>
        {platformIsNative ? (
          <NestableScrollContainer
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={true}
            testID="sidebar-status-list-scroll"
          >
            {content}
          </NestableScrollContainer>
        ) : (
          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={true}
            testID="sidebar-status-list-scroll"
          >
            {content}
          </ScrollView>
        )}
      </View>
    </SidebarWorkspaceRename>
  );
}

function StatusGroupList({
  groups,
  collapsedWorkspaceGroupKeys,
  projectIconByProjectViewKey,
  shortcutIndex,
  showShortcutBadges,
  onWorkspacePress,
  hostBadgeByServerId,
  supportsPinningByServerId,
  onToggleWorkspacePin,
  parentGestureRef,
  dragGestureHostActive,
}: {
  groups: SidebarWorkspaceGroup[];
  collapsedWorkspaceGroupKeys: ReadonlySet<string>;
  projectIconByProjectViewKey: ReadonlyMap<string, string | null>;
  shortcutIndex: Map<string, number>;
  showShortcutBadges: boolean;
  onWorkspacePress?: () => void;
  hostBadgeByServerId: ReadonlyMap<string, HostBadgeModel>;
  supportsPinningByServerId: ReadonlyMap<string, boolean>;
  onToggleWorkspacePin: ToggleSidebarWorkspacePin;
  parentGestureRef?: MutableRefObject<GestureType | undefined>;
  dragGestureHostActive?: boolean;
}) {
  const initialCount = useSidebarViewStore((state) => state.initialWorkspaceCount);
  const days = useSidebarViewStore((state) => state.workspaceUpdatedWithinDays);
  const now = useSidebarRecencyClock();
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<ReadonlySet<string>>(new Set());
  const positionTransitionDuration = useSidebarPositionTransitionDuration();
  const items = useMemo(
    () =>
      buildStatusListItems({
        groups,
        collapsedGroupKeys: collapsedWorkspaceGroupKeys,
        expandedGroupKeys,
        initialCount,
        updatedWithin: days === null ? undefined : { days, now },
      }),
    [groups, collapsedWorkspaceGroupKeys, expandedGroupKeys, initialCount, days, now],
  );

  const destinationGroupKeys = useMemo(() => {
    const result = new Map<string, string>();
    for (const group of groups) {
      for (const workspace of group.rows) result.set(workspace.workspaceKey, group.key);
    }
    return result;
  }, [groups]);

  const destinationGroupKeysRef = useRef(destinationGroupKeys);
  destinationGroupKeysRef.current = destinationGroupKeys;
  // Cleanup needs the new projection, even when a disappearing cell did not render again.
  const resolveDestinationGroupKey = useCallback(
    (workspaceKey: string) => destinationGroupKeysRef.current.get(workspaceKey),
    [],
  );

  const toggleExpanded = useCallback((key: string) => {
    setExpandedGroupKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleWorkspaceReorder = useCallback(
    (reordered: StatusListItem[]) => {
      if (
        !isDragGroupOrderValid({
          original: items,
          reordered,
          keyExtractor: statusListItemKey,
          getDragGroupKey: statusListDragGroupKey,
        })
      )
        return;
      // Preserve the former per-group persistence policy. Headers and other groups stay fixed.
      for (const group of groups) {
        const originalKeys = items
          .filter((item) => item.kind === "workspace" && item.groupKey === group.key)
          .map(statusListItemKey);
        const reorderedRows = reordered.filter(
          (item): item is Extract<StatusListItem, { kind: "workspace" }> =>
            item.kind === "workspace" && item.groupKey === group.key,
        );
        const reorderedKeys = reorderedRows.map(statusListItemKey);
        if (
          !hasVisibleOrderChanged({
            currentOrder: originalKeys,
            reorderedVisibleKeys: reorderedKeys,
          })
        )
          continue;
        const store = useSidebarOrderStore.getState();
        store.setStatusWorkspaceOrder(
          mergeWithRemainder({
            currentOrder: store.statusWorkspaceOrder,
            reorderedVisibleKeys: reorderedRows.map((item) => item.workspace.workspaceKey),
          }),
        );
        useSidebarViewStore.getState().setWorkspaceSortMode("custom");
        break;
      }
    },
    [groups, items],
  );

  const renderItem = useCallback(
    ({ item, drag, isActive, dragHandleProps }: DraggableRenderItemInfo<StatusListItem>) => {
      if (item.kind === "header") {
        return <SidebarWorkspaceGroupHeader group={item.group} collapsed={item.collapsed} />;
      }
      if (item.kind === "footer") {
        return <StatusGroupFooter item={item} onToggle={toggleExpanded} />;
      }
      const workspace = item.workspace;
      return (
        <StatusGroupCell
          workspaceKey={workspace.workspaceKey}
          groupKey={item.groupKey}
          resolveDestinationGroupKey={resolveDestinationGroupKey}
        >
          <StatusWorkspaceRow
            workspace={workspace}
            {...buildStatusRowProjectPresentation({
              workspace,
              projectIconByProjectViewKey,
              hostBadgeByServerId,
            })}
            shortcutNumber={shortcutIndex.get(workspace.workspaceKey) ?? null}
            showShortcutBadge={showShortcutBadges}
            canPin={supportsPinningByServerId.get(workspace.serverId) === true}
            onToggleWorkspacePin={onToggleWorkspacePin}
            onWorkspacePress={onWorkspacePress}
            drag={drag}
            isDragging={isActive}
            dragHandleProps={dragHandleProps}
          />
        </StatusGroupCell>
      );
    },
    [
      resolveDestinationGroupKey,
      projectIconByProjectViewKey,
      hostBadgeByServerId,
      shortcutIndex,
      showShortcutBadges,
      supportsPinningByServerId,
      onToggleWorkspacePin,
      onWorkspacePress,
      toggleExpanded,
    ],
  );

  return (
    <DraggableList
      testID="sidebar-status-workspace-list"
      data={items}
      keyExtractor={statusListItemKey}
      getDragGroupKey={statusListDragGroupKey}
      positionTransitionDuration={positionTransitionDuration}
      onDragEnd={handleWorkspaceReorder}
      scrollEnabled={false}
      useDragHandle
      nestable={platformIsNative}
      simultaneousGestureRef={parentGestureRef}
      gestureHostPresented={dragGestureHostActive}
      renderItem={renderItem}
    />
  );
}

/** Keep the group toggle callback stable across status updates and row moves. */
function StatusGroupFooter({
  item,
  onToggle,
}: {
  item: Extract<StatusListItem, { kind: "footer" }>;
  onToggle: (groupKey: string) => void;
}) {
  const handlePress = useCallback(() => onToggle(item.groupKey), [item.groupKey, onToggle]);
  return (
    <View style={styles.statusGroupBlockExpanded}>
      {item.canToggle ? (
        <SidebarGroupToggleRow
          expanded={item.expanded}
          onPress={handlePress}
          indented
          testID={`sidebar-status-group-show-more-${item.groupKey}`}
        />
      ) : null}
    </View>
  );
}

interface StatusRowProjectPresentation {
  hostBadge: HostBadgeModel | null;
  projectName: string;
  projectIconDataUri: string | null;
}

function buildStatusRowProjectPresentation({
  workspace,
  projectIconByProjectViewKey,
  hostBadgeByServerId,
}: {
  workspace: SidebarWorkspaceEntry;
  projectIconByProjectViewKey: ReadonlyMap<string, string | null>;
  hostBadgeByServerId: ReadonlyMap<string, HostBadgeModel>;
}): StatusRowProjectPresentation {
  return {
    hostBadge: hostBadgeByServerId.get(workspace.serverId) ?? null,
    projectName: workspace.projectName,
    projectIconDataUri: projectIconByProjectViewKey.get(workspace.projectViewKey) ?? null,
  };
}

const StatusWorkspaceRow = memo(function StatusWorkspaceRow({
  workspace,
  hostBadge,
  projectName,
  projectIconDataUri,
  shortcutNumber,
  showShortcutBadge,
  canPin,
  onToggleWorkspacePin,
  reserveIdleStatusIndicatorSpace = true,
  inStatusGroup = true,
  onWorkspacePress,
  drag,
  isDragging = false,
  dragHandleProps,
}: {
  workspace: SidebarWorkspaceEntry;
  hostBadge: HostBadgeModel | null;
  projectName: string;
  projectIconDataUri: string | null;
  shortcutNumber: number | null;
  showShortcutBadge: boolean;
  canPin: boolean;
  onToggleWorkspacePin: ToggleSidebarWorkspacePin;
  reserveIdleStatusIndicatorSpace?: boolean;
  /**
   * Whether the row sits under a status header, which is what it indents from. Pinned rows
   * are a flat list under their own header and sit flush.
   */
  inStatusGroup?: boolean;
  onWorkspacePress?: () => void;
  drag?: () => void;
  isDragging?: boolean;
  dragHandleProps?: DraggableListDragHandleProps;
}) {
  const activeWorkspaceSelection = useActiveWorkspaceSelection();
  const selected =
    activeWorkspaceSelection?.serverId === workspace.serverId &&
    activeWorkspaceSelection?.workspaceId === workspace.workspaceId;

  const handlePress = useCallback(() => {
    if (!workspace.serverId) return;
    onWorkspacePress?.();
    navigateToWorkspace({ serverId: workspace.serverId, workspaceId: workspace.workspaceId });
  }, [onWorkspacePress, workspace.serverId, workspace.workspaceId]);

  return (
    <StatusWorkspaceRowWithMenu
      workspace={workspace}
      hostBadge={hostBadge}
      projectName={projectName}
      projectIconDataUri={projectIconDataUri}
      selected={selected}
      shortcutNumber={shortcutNumber}
      showShortcutBadge={showShortcutBadge}
      canPin={canPin}
      onToggleWorkspacePin={onToggleWorkspacePin}
      reserveIdleStatusIndicatorSpace={reserveIdleStatusIndicatorSpace}
      inStatusGroup={inStatusGroup}
      onPress={handlePress}
      drag={drag}
      isDragging={isDragging}
      dragHandleProps={dragHandleProps}
    />
  );
});

function StatusWorkspaceRowWithMenu({
  workspace,
  hostBadge,
  projectName,
  projectIconDataUri,
  selected,
  shortcutNumber,
  showShortcutBadge,
  canPin,
  onToggleWorkspacePin,
  reserveIdleStatusIndicatorSpace = true,
  inStatusGroup = true,
  onPress,
  drag,
  isDragging = false,
  dragHandleProps,
}: {
  workspace: SidebarWorkspaceEntry;
  hostBadge: HostBadgeModel | null;
  projectName: string;
  projectIconDataUri: string | null;
  selected: boolean;
  shortcutNumber: number | null;
  showShortcutBadge: boolean;
  canPin: boolean;
  onToggleWorkspacePin: ToggleSidebarWorkspacePin;
  reserveIdleStatusIndicatorSpace?: boolean;
  /**
   * Whether the row sits under a status header, which is what it indents from. Pinned rows
   * are a flat list under their own header and sit flush.
   */
  inStatusGroup?: boolean;
  onPress: () => void;
  drag?: () => void;
  isDragging?: boolean;
  dragHandleProps?: DraggableListDragHandleProps;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [isHidingWorkspace, setIsHidingWorkspace] = useState(false);
  const openRename = useSidebarWorkspaceRename();
  const isArchiving = workspace.archivingAt !== null || isHidingWorkspace;

  const redirectAfterArchive = useCallback(() => {
    redirectIfArchivingActiveWorkspace({
      serverId: workspace.serverId,
      workspaceId: workspace.workspaceId,
      activeWorkspaceSelection: selected
        ? { serverId: workspace.serverId, workspaceId: workspace.workspaceId }
        : null,
    });
  }, [selected, workspace]);

  const archiveController = useWorkspaceArchive({
    serverId: workspace.serverId,
    workspaceId: workspace.workspaceId,
    workspaceKind: workspace.workspaceKind,
    name: workspace.name,
    ...toWorktreeArchiveRisk(workspace),
    onArchiveStarted: redirectAfterArchive,
    onSetHiding: setIsHidingWorkspace,
  });

  const handleArchive = useCallback(() => {
    if (isArchiving) return;
    archiveController.archive();
  }, [archiveController, isArchiving]);

  const clipboard = useWorkspaceClipboardActions();
  const handleCopyPath = useCallback(() => {
    clipboard.copyPath(workspace);
  }, [clipboard, workspace]);

  const handleCopyBranchName = useCallback(() => {
    clipboard.copyBranchName(workspace);
  }, [clipboard, workspace]);

  const handleOpenRename = useCallback(() => openRename(workspace), [openRename, workspace]);
  const isPinned = workspace.pinnedAt != null;
  const isProjectPinned = workspace.projectPinnedAt != null;
  const onToggleProjectPin = useCallback(() => {
    onToggleWorkspacePin(workspace, "project");
  }, [onToggleWorkspacePin, workspace]);
  const handleTogglePin = useCallback(() => {
    onToggleWorkspacePin(workspace);
  }, [onToggleWorkspacePin, workspace]);
  const onTogglePin = canPin ? handleTogglePin : undefined;

  const archiveShortcutKeys = useShortcutKeys("archive-workspace");
  const { hasClearableAttention, canMarkUnread, clearAttention, markUnread } =
    useWorkspaceReadState({
      serverId: workspace.serverId,
      workspaceId: workspace.workspaceId,
    });
  const handleMarkAsRead = useCallback(() => {
    void clearAttention().catch((error) => {
      toast.error(error instanceof Error ? error.message : "Failed to mark workspace as read");
    });
  }, [clearAttention, toast]);
  const handleMarkAsUnread = useCallback(() => {
    void markUnread().catch((error) => {
      toast.error(error instanceof Error ? error.message : "Failed to mark workspace as unread");
    });
  }, [markUnread, toast]);

  useKeyboardActionHandler({
    handlerId: `workspace-archive-${workspace.workspaceKey}`,
    actions: ["workspace.archive"],
    enabled: selected && !isArchiving,
    priority: 0,
    handle: () => {
      handleArchive();
      return true;
    },
  });

  return (
    <StatusWorkspaceRowInner
      workspace={workspace}
      hostBadge={hostBadge}
      projectName={projectName}
      projectIconDataUri={projectIconDataUri}
      selected={selected}
      shortcutNumber={shortcutNumber}
      showShortcutBadge={showShortcutBadge}
      onPress={onPress}
      isArchiving={isArchiving}
      archiveLabel={t("sidebar.workspace.actions.archive")}
      archiveStatus={isArchiving ? "pending" : "idle"}
      archivePendingLabel={t("sidebar.workspace.actions.archiving")}
      onArchive={handleArchive}
      onCopyBranchName={workspace.projectKind === "git" ? handleCopyBranchName : undefined}
      onCopyPath={handleCopyPath}
      onRename={handleOpenRename}
      onMarkAsRead={hasClearableAttention ? handleMarkAsRead : undefined}
      onMarkAsUnread={canMarkUnread ? handleMarkAsUnread : undefined}
      archiveShortcutKeys={selected ? archiveShortcutKeys : null}
      isPinned={isPinned}
      onTogglePin={onTogglePin}
      isProjectPinned={isProjectPinned}
      onToggleProjectPin={onToggleProjectPin}
      reserveIdleStatusIndicatorSpace={reserveIdleStatusIndicatorSpace}
      inStatusGroup={inStatusGroup}
      drag={drag}
      isDragging={isDragging}
      dragHandleProps={dragHandleProps}
    />
  );
}

interface StatusWorkspaceRowInnerProps {
  workspace: SidebarWorkspaceEntry;
  hostBadge: HostBadgeModel | null;
  projectName: string;
  projectIconDataUri: string | null;
  selected: boolean;
  shortcutNumber: number | null;
  showShortcutBadge: boolean;
  onPress: () => void;
  isArchiving: boolean;
  archiveLabel?: string;
  archiveStatus?: "idle" | "pending" | "success";
  archivePendingLabel?: string;
  onArchive?: () => void;
  onCopyBranchName?: () => void;
  onCopyPath?: () => void;
  onRename?: () => void;
  onMarkAsRead?: () => void;
  onMarkAsUnread?: () => void;
  archiveShortcutKeys?: ShortcutKey[][] | null;
  isPinned?: boolean;
  onTogglePin?: () => void;
  isProjectPinned?: boolean;
  onToggleProjectPin?: () => void;
  reserveIdleStatusIndicatorSpace?: boolean;
  /** Pinned rows are flat under their own header; status-group rows indent from theirs. */
  inStatusGroup?: boolean;
  drag?: () => void;
  isDragging?: boolean;
  dragHandleProps?: DraggableListDragHandleProps;
}

function StatusWorkspaceRowInner(props: StatusWorkspaceRowInnerProps) {
  if (props.drag) {
    return <DraggableStatusWorkspaceRowInner {...props} drag={props.drag} />;
  }
  return <StatusWorkspaceRowInnerContent {...props} />;
}

function DraggableStatusWorkspaceRowInner(
  props: StatusWorkspaceRowInnerProps & { drag: () => void },
) {
  const dragInteraction = useLongPressDragInteraction({
    drag: props.drag,
    menuController: null,
  });
  return <StatusWorkspaceRowInnerContent {...props} dragInteraction={dragInteraction} />;
}

function StatusWorkspaceRowInnerContent({
  workspace,
  hostBadge,
  projectName,
  projectIconDataUri,
  selected,
  shortcutNumber,
  showShortcutBadge,
  onPress,
  isArchiving,
  archiveLabel,
  archiveStatus = "idle",
  archivePendingLabel,
  onArchive,
  onCopyBranchName,
  onCopyPath,
  onRename,
  onMarkAsRead,
  onMarkAsUnread,
  archiveShortcutKeys,
  isPinned,
  onTogglePin,
  isProjectPinned,
  onToggleProjectPin,
  reserveIdleStatusIndicatorSpace = true,
  inStatusGroup = true,
  isDragging = false,
  dragHandleProps,
  dragInteraction,
}: StatusWorkspaceRowInnerProps & {
  dragInteraction?: ReturnType<typeof useLongPressDragInteraction>;
}) {
  const isCompact = useIsCompactFormFactor();
  const isTouchPlatform = platformIsNative || isCompact;
  const [isPressed, setIsPressed] = useState(false);
  const trailing = useSidebarWorkspaceTrailing();
  const {
    role: _dragRole,
    tabIndex: _dragTabIndex,
    "aria-roledescription": _dragRoleDescription,
    ...dragAttributes
  } = dragHandleProps?.attributes ?? {};

  const isDesktop = !isTouchPlatform;
  const serviceSummary = isDesktop ? selectWorkspaceServiceSummary(workspace.scripts) : null;

  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  const didLongPressRef = dragInteraction?.didLongPressRef;
  const startDragPress = dragInteraction?.handlePressIn;
  const moveDragPress = dragInteraction?.handleTouchMove;
  const endDragPress = dragInteraction?.handlePressOut;
  const handlePress = useCallback(() => {
    if (didLongPressRef?.current) {
      didLongPressRef.current = false;
      return;
    }
    onPress();
  }, [didLongPressRef, onPress]);
  const handlePressIn = useCallback(
    (event: GestureResponderEvent) => {
      setIsPressed(true);
      startDragPress?.(event);
    },
    [startDragPress],
  );
  const handlePressOut = useCallback(() => {
    setIsPressed(false);
    endDragPress?.();
  }, [endDragPress]);

  return (
    <SidebarWorkspaceRowFrame workspace={workspace} isDragging={isDragging}>
      {({ isHovered, contextMenuOpen, onContextMenuOpenChange, hoverHandlers }) => {
        const showShortcut = showShortcutBadge && shortcutNumber !== null;
        const {
          trailingPresentation,
          showKebab: showKebabInSlot,
          renderSlot,
          reserveSlotWidth,
        } = resolveTrailingActionVisibility({
          workspace,
          trailing,
          hasArchiveAction: Boolean(onArchive),
          isHovered,
          isTouchPlatform,
          showShortcut,
        });
        const workspaceRowStyle = getStatusWorkspaceRowStyle({
          isPressed,
          selected,
          isHovered,
          inStatusGroup,
          isDragging,
        });
        const backdrop = getSidebarRowBackdrop({ isDragging, isPressed, selected, isHovered });
        return (
          <View
            {...dragAttributes}
            {...dragHandleProps?.listeners}
            ref={dragHandleProps?.setActivatorNodeRef as unknown as Ref<View>}
            style={styles.workspaceRowContainer}
            {...hoverHandlers}
          >
            <SidebarWorkspaceContextMenu
              contextMenuOpen={contextMenuOpen}
              onContextMenuOpenChange={onContextMenuOpenChange}
              workspace={workspace}
              leadingProjectName={projectName}
              hostBadgeLabel={hostBadge?.label}
              serviceSummary={serviceSummary}
              workspaceKey={workspace.workspaceKey}
              onCopyPath={onCopyPath}
              onCopyBranchName={onCopyBranchName}
              onRename={onRename}
              onMarkAsRead={onMarkAsRead}
              onMarkAsUnread={onMarkAsUnread}
              onArchive={onArchive}
              archiveLabel={archiveLabel}
              archiveStatus={archiveStatus}
              archivePendingLabel={archivePendingLabel}
              archiveShortcutKeys={archiveShortcutKeys}
              isPinned={isPinned}
              onTogglePin={onTogglePin}
              isProjectPinned={isProjectPinned}
              onToggleProjectPin={onToggleProjectPin}
              openInFileManagerPath={workspace.workspaceDirectory}
              disabled={isArchiving}
              accessibilityRole="button"
              accessibilityState={accessibilityState}
              style={workspaceRowStyle}
              highlightStyle={styles.workspaceRowPressed}
              onPressIn={handlePressIn}
              onTouchMove={moveDragPress}
              onPressOut={handlePressOut}
              onPress={handlePress}
              testID={`sidebar-workspace-row-${workspace.workspaceKey}`}
            >
              <SidebarWorkspaceRowContent
                workspace={workspace}
                hostBadge={hostBadge}
                leadingProjectName={projectName}
                leadingProjectIconDataUri={projectIconDataUri}
                serviceSummary={serviceSummary}
                backdrop={backdrop}
                isHovered={isHovered}
                isLoading={isArchiving}
                shortcutNumber={shortcutNumber}
                showShortcutBadge={showShortcutBadge}
                reserveIdleStatusIndicatorSpace={reserveIdleStatusIndicatorSpace}
              >
                {renderSlot ? (
                  <StatusWorkspaceActionSlot
                    workspace={workspace}
                    trailing={trailing}
                    trailingPresentation={trailingPresentation}
                    showKebab={showKebabInSlot}
                    reserveSlotWidth={reserveSlotWidth}
                    isPinned={isPinned}
                    onTogglePin={onTogglePin}
                    isProjectPinned={isProjectPinned}
                    onToggleProjectPin={onToggleProjectPin}
                    onCopyPath={onCopyPath}
                    onCopyBranchName={onCopyBranchName}
                    onRename={onRename}
                    onMarkAsRead={onMarkAsRead}
                    onMarkAsUnread={onMarkAsUnread}
                    onArchive={onArchive}
                    archiveLabel={archiveLabel}
                    archiveStatus={archiveStatus}
                    archivePendingLabel={archivePendingLabel}
                    archiveShortcutKeys={archiveShortcutKeys}
                  />
                ) : null}
              </SidebarWorkspaceRowContent>
            </SidebarWorkspaceContextMenu>
          </View>
        );
      }}
    </SidebarWorkspaceRowFrame>
  );
}

function StatusWorkspaceActionSlot({
  workspace,
  trailing,
  trailingPresentation,
  showKebab,
  reserveSlotWidth,
  isPinned,
  onTogglePin,
  isProjectPinned,
  onToggleProjectPin,
  onCopyPath,
  onCopyBranchName,
  onRename,
  onMarkAsRead,
  onMarkAsUnread,
  onArchive,
  archiveLabel,
  archiveStatus,
  archivePendingLabel,
  archiveShortcutKeys,
}: {
  workspace: SidebarWorkspaceEntry;
  trailing: SidebarWorkspaceTrailing;
  trailingPresentation: SidebarWorkspaceTrailingPresentation;
  showKebab: boolean;
  reserveSlotWidth: boolean;
  isPinned?: boolean;
  onTogglePin?: () => void;
  isProjectPinned?: boolean;
  onToggleProjectPin?: () => void;
  onCopyPath?: () => void;
  onCopyBranchName?: () => void;
  onRename?: () => void;
  onMarkAsRead?: () => void;
  onMarkAsUnread?: () => void;
  onArchive?: () => void;
  archiveLabel?: string;
  archiveStatus?: "idle" | "pending" | "success";
  archivePendingLabel?: string;
  archiveShortcutKeys?: ShortcutKey[][] | null;
}) {
  const kebab = useOpenKebabMenuVisibility(showKebab);
  return (
    <SidebarWorkspaceTrailingActionSlot reserveWidth={reserveSlotWidth}>
      <SidebarWorkspaceTrailingActionBase presentation={trailingPresentation}>
        <SidebarWorkspaceTrailingContent workspace={workspace} trailing={trailing} />
      </SidebarWorkspaceTrailingActionBase>
      <SidebarWorkspaceTrailingStatusActions workspace={workspace} visible={kebab.showKebab}>
        {kebab.showKebab && onArchive ? (
          <SidebarWorkspaceMenu
            {...kebab.menuProps}
            workspaceKey={workspace.workspaceKey}
            serverId={workspace.serverId}
            workspaceId={workspace.workspaceId}
            workspaceLabels={workspace.labels}
            onCopyPath={onCopyPath}
            onCopyBranchName={onCopyBranchName}
            onRename={onRename}
            onMarkAsRead={onMarkAsRead}
            onMarkAsUnread={onMarkAsUnread}
            onArchive={onArchive}
            archiveLabel={archiveLabel}
            archiveStatus={archiveStatus}
            archivePendingLabel={archivePendingLabel}
            archiveShortcutKeys={archiveShortcutKeys}
            isPinned={isPinned}
            onTogglePin={onTogglePin}
            isProjectPinned={isProjectPinned}
            onToggleProjectPin={onToggleProjectPin}
          />
        ) : null}
      </SidebarWorkspaceTrailingStatusActions>
    </SidebarWorkspaceTrailingActionSlot>
  );
}

function getStatusWorkspaceRowStyle({
  isPressed,
  selected,
  isHovered,
  inStatusGroup,
  isDragging,
}: {
  isPressed: boolean;
  selected: boolean;
  isHovered: boolean;
  inStatusGroup: boolean;
  isDragging: boolean;
}) {
  return [
    styles.workspaceRow,
    inStatusGroup && sidebarWorkspaceRowStyles.rowIndented,
    isHovered && styles.workspaceRowHovered,
    selected && styles.sidebarRowSelected,
    isDragging && styles.workspaceRowDragging,
    isPressed && styles.workspaceRowPressed,
  ];
}

const styles = StyleSheet.create((theme) => ({
  workspaceRowContainer: {
    position: "relative",
  },

  container: {
    flex: 1,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: theme.spacing[2],
    // Keep status mode's Pinned/Workspaces boundary identical to project mode.
    paddingTop: 2,
    paddingBottom: theme.spacing[4],
  },
  pinnedSection: {
    marginBottom: theme.spacing[1],
  },
  // Matches `projectBlockExpanded` in sidebar-workspace-list.tsx. See the note there.
  statusGroupBlockExpanded: {
    paddingBottom: theme.spacing[3],
  },
  statusWorkspaceListContainer: {},
  workspaceRow: {
    minHeight: 36,
    marginBottom: theme.spacing[0.5],
    paddingVertical: theme.spacing[2],
    paddingLeft: theme.spacing[2],
    paddingRight: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    flexDirection: "column",
    alignItems: "stretch",
    justifyContent: "flex-start",
    gap: theme.spacing[1],
    userSelect: "none",
  },
  workspaceRowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  workspaceRowPressed: {
    backgroundColor: theme.colors.surface2,
  },
  workspaceRowDragging: {
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    transform: [{ scale: 1.02 }],
    zIndex: 3,
    ...theme.shadow.md,
  },
  sidebarRowSelected: {
    backgroundColor: theme.colors.surfaceSidebarSelected,
  },
}));
