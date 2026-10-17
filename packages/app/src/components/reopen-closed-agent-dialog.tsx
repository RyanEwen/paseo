import { useCallback, useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { AgentList } from "@/components/agent-list";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useAgentHistory } from "@/hooks/use-agent-history";
import { resolveClosedAgentDialogState, selectPreviousAgents } from "@/hooks/previous-agents";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useSessionStore } from "@/stores/session-store";
import { collectAllTabs, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import type { Theme } from "@/styles/theme";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const mutedSpinnerColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const SNAP_POINTS = ["70%", "92%"];

/** Browse closed tabs in the current workspace without changing either archive lifecycle. */
export function ReopenClosedAgentDialog({
  serverId,
  workspaceId,
  onClose,
}: {
  serverId: string;
  workspaceId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput, 200).trim();
  // COMPAT(workspaceAgentHistory): added in v0.11.2, remove after 2027-04-11.
  const supported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.workspaceAgentHistory === true,
  );
  const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
  const layout = useWorkspaceLayoutStore((state) =>
    workspaceKey ? state.layoutByWorkspace[workspaceKey] : undefined,
  );
  const history = useAgentHistory({ serverId, workspaceId, search, enabled: supported });
  const { agents: historyAgents, hasMore, isLoadingMore, loadMore, refreshAll } = history;
  const agents = useMemo(
    () => selectPreviousAgents(historyAgents, layout ? collectAllTabs(layout.root) : []),
    [historyAgents, layout],
  );
  const { failed, scanningOpenPages, showLoading } = resolveClosedAgentDialogState({
    closedAgentCount: agents.length,
    history,
  });
  useEffect(() => {
    if (scanningOpenPages && !isLoadingMore) loadMore();
  }, [scanningOpenPages, isLoadingMore, loadMore]);
  const refresh = useCallback(() => {
    void refreshAll();
  }, [refreshAll]);
  const header = useMemo<SheetHeader>(
    () => ({
      title: t("sessions.previousTitle"),
      search: history.isSearchSupported
        ? {
            onChange: setSearchInput,
            placeholder: t("sessions.searchPlaceholder"),
            autoFocus: true,
            testID: "reopen-closed-agent-search",
          }
        : undefined,
    }),
    [t, history.isSearchSupported],
  );
  const footer = useMemo(
    () =>
      hasMore ? (
        <View style={styles.footer}>
          <Button variant="ghost" onPress={loadMore} disabled={isLoadingMore || failed}>
            {isLoadingMore && !failed ? t("common.loading") : t("sessions.actions.loadMore")}
          </Button>
        </View>
      ) : null,
    [hasMore, isLoadingMore, failed, loadMore, t],
  );

  let content;
  if (!supported && !failed) {
    content = (
      <View style={styles.state}>
        <Text style={styles.hint}>{t("sessions.workspaceHistoryUpdateRequired")}</Text>
      </View>
    );
  } else if (showLoading) {
    content = (
      <View style={styles.state} testID="reopen-closed-agent-loading">
        <ThemedLoadingSpinner color="" uniProps={mutedSpinnerColor} />
      </View>
    );
  } else {
    content = (
      <>
        {failed ? (
          <View style={styles.state} testID="reopen-closed-agent-error">
            <Text style={styles.hint}>{t("sessions.hostLoadFailed", { host: serverId })}</Text>
            <Button variant="ghost" onPress={refresh}>
              {t("common.actions.retry")}
            </Button>
          </View>
        ) : null}
        {agents.length === 0 && !failed ? (
          <View style={styles.state} testID="reopen-closed-agent-empty">
            <Text style={styles.hint}>
              {search ? t("sessions.noMatches") : t("sessions.previousEmpty")}
            </Text>
          </View>
        ) : null}
        {agents.length > 0 ? (
          <AgentList
            rowLayout="stacked"
            agents={agents}
            showCheckoutInfo={false}
            showAttentionIndicator={false}
            onAgentSelect={onClose}
            onRefresh={refresh}
            isRefreshing={history.isRevalidating}
            listFooterComponent={footer}
            search={search || undefined}
          />
        ) : null}
      </>
    );
  }

  return (
    <AdaptiveModalSheet
      header={header}
      visible
      onClose={onClose}
      testID="reopen-closed-agent-dialog"
      snapPoints={SNAP_POINTS}
      desktopMaxWidth={720}
      desktopHeight="70%"
      scrollable={false}
    >
      <View style={styles.body} testID="reopen-closed-agent-dialog-content">
        {content}
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: { flex: 1, minHeight: 0 },
  state: { padding: theme.spacing[6], gap: theme.spacing[3], alignItems: "center" },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.base },
  footer: { padding: theme.spacing[3], alignItems: "center" },
}));
