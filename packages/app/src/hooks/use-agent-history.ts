import { useInfiniteQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { getHostRuntimeStore, isHostRuntimeConnected, useHosts } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { agentHistoryQueryKey, allAgentHistoryQueryKey } from "./agent-history-query-key";

import {
  fetchAgentHistoryBatch,
  sortByLatestActivity,
  getNextAgentHistoryPageParam,
  collectAgentHistoryHostErrors,
  type AgentHistoryResult,
  type AgentHistoryHost,
  type AgentHistoryHostError,
  type AgentHistoryBatchPage,
  type AgentHistoryCursorByServerId,
} from "./agent-history-fetch";
export {
  fetchAgentHistoryBatch,
  fetchAgentHistoryPage,
  collectAgentHistoryHostErrors,
} from "./agent-history-fetch";
export type {
  AgentHistoryResult,
  AgentHistoryClient,
  AgentHistoryHost,
  AgentHistoryHostError,
} from "./agent-history-fetch";

export function useAgentHistory(options: {
  serverId?: string | null;
  enabled?: boolean;
  search?: string;
  workspaceId?: string;
}): AgentHistoryResult {
  "use no memo";
  // Host selection reads a mutable external store. Preserve its explicit version
  // dependency, which React Compiler otherwise removes as an unused read.
  const { t } = useTranslation();
  const daemons = useHosts();
  const runtime = getHostRuntimeStore();
  const runtimeVersion = useSyncExternalStore(
    (onStoreChange) => runtime.subscribeAll(onStoreChange),
    () => runtime.getVersion(),
    () => runtime.getVersion(),
  );
  const serverId = useMemo(() => {
    const value = options.serverId;
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }, [options.serverId]);
  const enabled = options.enabled ?? true;
  // A host the user asked about splits two ways: one this fetch can reach, and
  // one whose sessions will be missing from the answer. Both come out of here,
  // because dropping the unreachable ones silently is what lets the list — and
  // worse, "No sessions match" — overstate what was actually searched.
  const { targetHosts, unreachableHosts } = useMemo(() => {
    void runtimeVersion;
    const serverLabelById = new Map(daemons.map((daemon) => [daemon.serverId, daemon.label]));
    const serverIds = serverId ? [serverId] : daemons.map((daemon) => daemon.serverId);
    const hosts: AgentHistoryHost[] = [];
    const unreachable: AgentHistoryHostError[] = [];

    for (const targetServerId of serverIds) {
      const snapshot = runtime.getSnapshot(targetServerId);
      const client = runtime.getClient(targetServerId);
      const serverName = serverLabelById.get(targetServerId) ?? targetServerId;
      if (!client || !isHostRuntimeConnected(snapshot)) {
        unreachable.push({ serverId: targetServerId, serverName });
        continue;
      }
      hosts.push({ serverId: targetServerId, serverLabel: serverName, client });
    }

    return { targetHosts: hosts, unreachableHosts: unreachable };
  }, [daemons, runtime, runtimeVersion, serverId]);
  const targetServerIds = useMemo(() => targetHosts.map((host) => host.serverId), [targetHosts]);
  // One gate, checked before the field is offered: a fleet where any host
  // predates search has no search, rather than a list that silently omits that
  // host's sessions.
  const isSearchSupported = useSessionStore(
    useCallback(
      (state) =>
        targetServerIds.length > 0 &&
        targetServerIds.every(
          (id) => state.sessions[id]?.serverInfo?.features?.agentHistorySearch === true,
        ),
      [targetServerIds],
    ),
  );
  const search = useMemo(() => {
    const trimmed = options.search?.trim() ?? "";
    return isSearchSupported ? trimmed : "";
  }, [isSearchSupported, options.search]);
  const queryKey = useMemo(
    () => [
      ...(serverId ? agentHistoryQueryKey(serverId) : allAgentHistoryQueryKey(targetServerIds)),
      search,
      options.workspaceId ?? null,
    ],
    [search, serverId, targetServerIds, options.workspaceId],
  );
  const serverLabelById = useMemo(
    () => new Map(daemons.map((daemon) => [daemon.serverId, daemon.label])),
    [daemons],
  );

  const historyQuery = useInfiniteQuery<
    AgentHistoryBatchPage,
    Error,
    { pages: AgentHistoryBatchPage[] },
    readonly unknown[],
    AgentHistoryCursorByServerId | null
  >({
    queryKey,
    enabled: Boolean(enabled && targetHosts.length > 0),
    staleTime: 30_000,
    initialPageParam: null,
    getNextPageParam: getNextAgentHistoryPageParam,
    queryFn: async ({ pageParam }) => {
      if (targetHosts.length === 0) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      return fetchAgentHistoryBatch({
        hosts: targetHosts,
        cursorByServerId: pageParam,
        workspaceId: options.workspaceId,
        ...(search ? { search } : {}),
      });
    },
  });
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isError,
    isFetching,
    isFetchingNextPage,
    isLoading,
    refetch,
  } = historyQuery;

  const refreshAll = useCallback(async () => {
    if (!enabled || targetHosts.length === 0) {
      return;
    }
    await refetch();
  }, [enabled, refetch, targetHosts.length]);

  const loadMore = useCallback(() => {
    if (!enabled || targetHosts.length === 0 || !hasNextPage || isFetchingNextPage) {
      return;
    }
    void fetchNextPage();
  }, [enabled, fetchNextPage, hasNextPage, isFetchingNextPage, targetHosts.length]);

  const agents = useMemo(() => {
    const pages = data?.pages ?? [];
    const historyAgents = pages.flatMap((page) => page.agents);
    const labelledAgents = historyAgents.map((agent) =>
      Object.assign({}, agent, {
        serverLabel: serverLabelById.get(agent.serverId) ?? agent.serverLabel,
      }),
    );
    return sortByLatestActivity(labelledAgents);
  }, [data?.pages, serverLabelById]);
  const isInitialLoad = isLoading && agents.length === 0;
  const isRevalidating = isFetching && !isFetchingNextPage && agents.length > 0;
  const isSearchTruncated = Boolean(search && data?.pages.some((page) => page.isSearchTruncated));
  const hostErrors = useMemo(
    () => collectAgentHistoryHostErrors({ pages: data?.pages ?? [], unreachableHosts }),
    [data?.pages, unreachableHosts],
  );

  return {
    agents,
    isLoading,
    isInitialLoad,
    isRevalidating,
    isError,
    hasMore: hasNextPage,
    isLoadingMore: isFetchingNextPage,
    isSearchSupported,
    isSearchTruncated,
    hostErrors,
    refreshAll,
    loadMore,
  };
}
