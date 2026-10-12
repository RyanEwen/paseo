/** @vitest-environment jsdom */
import React from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NewTabLauncherProvider,
  useWorkspaceTabLaunchCatalog,
  type WorkspaceTabLaunchGroup,
} from "../index";

const fixture = vi.hoisted(() => ({ enabled: true, mounts: 0, unmounts: 0 }));
vi.mock("@/hooks/use-settings", () => ({
  useAppSettings: () => ({ settings: { paseoPlusPlus: { previousAgents: fixture.enabled } } }),
}));
vi.mock("@/components/reopen-closed-agent-dialog", async () => {
  const { useEffect } = await import("react");
  return {
    ReopenClosedAgentDialog: () => {
      useEffect(() => {
        fixture.mounts += 1;
        return () => {
          fixture.unmounts += 1;
        };
      }, []);
      return null;
    },
  };
});
vi.mock("expo-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("lucide-react-native", () => ({
  Globe: () => null,
  History: () => null,
  SquarePen: () => null,
  SquareTerminal: () => null,
}));
vi.mock("@/hooks/use-daemon-config", () => ({ useDaemonConfig: () => ({ config: {} }) }));
vi.mock("@/plugins/icons", () => ({ resolvePluginIcon: vi.fn() }));
vi.mock("@/plugins/registry", () => ({ useInstalledPlugins: () => [] }));
vi.mock("@/panels/register-panels", () => ({ ensurePanelsRegistered: vi.fn() }));
vi.mock("@/panels/panel-manifest", () => ({
  panelCanLaunchInPane: () => true,
  panelSupportsHost: () => true,
}));
vi.mock("@/panels/panel-registry", () => ({
  getPanelRegistration: () => ({ presentation: { label: () => "Panel", icon: () => null } }),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Flatten the shared catalog exactly as compact menus consume it. */
function flattenCatalog(groups: readonly WorkspaceTabLaunchGroup[]) {
  return groups.flatMap((group) => group.items);
}
import { getBuiltInLaunchOrder } from "./catalog";

describe("getBuiltInLaunchOrder", () => {
  it("leads with creating work in a primary pane", () => {
    expect(getBuiltInLaunchOrder("primary")).toEqual([
      "agent",
      "terminal",
      "changes",
      "diff",
      "files",
      "browser",
      "pullRequest",
    ]);
  });

  it("leads with companion tools in a supporting pane", () => {
    expect(getBuiltInLaunchOrder("supporting")).toEqual([
      "changes",
      "terminal",
      "diff",
      "files",
      "agent",
      "browser",
      "pullRequest",
    ]);
  });
});

describe("previous agent launcher preference", () => {
  it("hides every catalog surface and dismisses the dialog without launching sessions", () => {
    vi.stubGlobal("React", React);
    fixture.enabled = true;
    fixture.mounts = 0;
    fixture.unmounts = 0;
    const launch = vi.fn();
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(NewTabLauncherProvider, {
        value: {
          serverId: "host",
          workspaceId: "workspace",
          showChanges: true,
          showPullRequest: true,
          showBrowser: true,
          terminalDisabled: false,
          launch,
        },
        // This existing .ts suite uses createElement rather than JSX.
        // eslint-disable-next-line react/no-children-prop
        children,
      });
    const { result, rerender } = renderHook(
      () => {
        const menu = useWorkspaceTabLaunchCatalog({
          serverId: "host",
          purpose: "primary",
          host: "main",
          surface: "menu",
        });
        const panel = useWorkspaceTabLaunchCatalog({
          serverId: "host",
          purpose: "supporting",
          host: "main",
          surface: "panel",
        });
        return {
          menu: flattenCatalog(menu),
          panel: flattenCatalog(panel),
        };
      },
      { wrapper },
    );
    const previous = result.current.menu.find((item) => item.id === "reopen-closed-agent")!;
    act(() => previous.launch({ kind: "open" }));
    expect(fixture.mounts).toBe(1);
    fixture.enabled = false;
    rerender();
    expect(result.current.menu.some((item) => item.id === "reopen-closed-agent")).toBe(false);
    expect(result.current.panel.some((item) => item.id === "reopen-closed-agent")).toBe(false);
    expect(result.current.menu.some((item) => item.id === "agent")).toBe(true);
    expect(fixture.unmounts).toBe(1);
    // A menu action captured before the preference change cannot resurrect the dialog.
    act(() => previous.launch({ kind: "open" }));
    fixture.enabled = true;
    rerender();
    expect(fixture.mounts).toBe(1);
    expect(result.current.menu.some((item) => item.id === "reopen-closed-agent")).toBe(true);
    const restored = result.current.menu.find((item) => item.id === "reopen-closed-agent")!;
    act(() => restored.launch({ kind: "open" }));
    expect(fixture.mounts).toBe(2);
    expect(launch).not.toHaveBeenCalled();
  });
});
