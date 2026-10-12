import { isAgentNotificationViewVisible } from "@/notifications/seen-agent";
import { usePanelStore } from "@/stores/panel-store";
import { getIsAppActivelyVisible } from "@/utils/app-visibility";
import { useLayoutEffect } from "react";
import { useAppActivelyVisible } from "@/hooks/use-app-visible";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useMobilePanelVisibilityCheck } from "@/mobile-panels/provider";
import { useIsMobilePanelActive } from "@/mobile-panels/provider";
import { useIsCompactFormFactor } from "@/constants/layout";
import { seenAgentNotifications } from "@/notifications/seen-agent-client";

/** Acknowledge only a painted chat in the focused pane of the foreground workspace. */
export function useSeenAgentNotifications(input: {
  serverId: string;
  agentId: string | undefined;
  focused: boolean;
  ready: boolean;
}): void {
  const foreground = useAppActivelyVisible();
  const panelVisible = useRetainedPanelActive();
  const compact = useIsCompactFormFactor();
  const { isAtRest, subscribe } = useMobilePanelVisibilityCheck("agent");
  const centerVisible = useIsMobilePanelActive("agent");
  const centerRequested = usePanelStore((state) => state.mobilePanel.target === "agent");
  const visible = isAgentNotificationViewVisible({
    foreground,
    panelVisible,
    compact,
    centerVisible,
    centerRequested,
    focused: input.focused,
    ready: input.ready,
  });
  useLayoutEffect(() => {
    if (!visible || !input.agentId) return;
    const release = seenAgentNotifications.view({
      target: { serverId: input.serverId, agentId: input.agentId },
      isVisible: () =>
        getIsAppActivelyVisible() &&
        (!compact || (usePanelStore.getState().mobilePanel.target === "agent" && isAtRest())),
    });
    const unsubscribe = compact
      ? subscribe(() => {
          void seenAgentNotifications.refreshVisibility();
        })
      : () => {};
    return () => {
      unsubscribe();
      release();
    };
  }, [compact, input.agentId, input.serverId, isAtRest, subscribe, visible]);
}
