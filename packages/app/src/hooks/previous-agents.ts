import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import type { AgentHistoryResult } from "./agent-history-fetch";
import type { WorkspaceTab } from "@/workspace-tabs/model";

/** Keep unopened conversations once each; runtime status does not indicate tab visibility. */
export function selectPreviousAgents(
  agents: readonly AggregatedAgent[],
  tabs: readonly WorkspaceTab[],
): AggregatedAgent[] {
  const openIds = new Set(
    tabs.flatMap((tab) => (tab.target.kind === "agent" ? [tab.target.agentId] : [])),
  );
  const seen = new Set<string>();
  return agents.filter((agent) => {
    const key = `${agent.serverId}:${agent.id}`;
    if (openIds.has(agent.id) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Derive progress after excluding open tabs from the history rows.
 * Disconnected hosts can retain successful cursors or an in-flight initial request,
 * so host failure takes precedence over either source of progress.
 */
export function resolveClosedAgentDialogState(input: {
  closedAgentCount: number;
  history: Pick<AgentHistoryResult, "hasMore" | "isError" | "hostErrors" | "isInitialLoad">;
}) {
  const failed = input.history.isError || input.history.hostErrors.length > 0;
  const scanningOpenPages = input.closedAgentCount === 0 && input.history.hasMore && !failed;
  const showLoading =
    !failed && input.closedAgentCount === 0 && (input.history.isInitialLoad || scanningOpenPages);
  return { failed, scanningOpenPages, showLoading };
}
