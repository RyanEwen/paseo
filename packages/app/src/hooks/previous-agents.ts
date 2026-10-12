import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
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
