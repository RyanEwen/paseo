import type { SettingsExampleImage } from "@/components/settings/settings-example";
import type { PaseoPlusPlusFeature } from "./preferences";

/** Actual cropped app pixels with separate explanatory arrows. Android checks have text help only. */
export const FEATURE_EXAMPLE_IMAGES: Partial<
  Record<PaseoPlusPlusFeature | "descriptiveToolCalls", readonly SettingsExampleImage[]>
> = {
  descriptiveToolCalls: [
    {
      id: "descriptive-tool-calls",
      source: require("../../assets/settings-examples/descriptive-tool-calls.png"),
      width: 330,
      height: 128,
      arrows: [{ fromX: 306, fromY: 32, toX: 246, toY: 15 }],
    },
  ],
  stickyUserPrompts: [
    {
      id: "sticky-user-prompts",
      source: require("../../assets/settings-examples/sticky-user-prompts.png"),
      width: 390,
      height: 165,
      arrows: [{ fromX: 374, fromY: 146, toX: 352, toY: 100 }],
    },
  ],
  previousAgents: [
    {
      id: "previous-agents",
      source: require("../../assets/settings-examples/previous-agents.png"),
      width: 330,
      height: 270,
      arrows: [{ fromX: 302, fromY: 184, toX: 262, toY: 219 }],
    },
  ],
  sidebarProjectSelector: [
    {
      id: "project-selector",
      source: require("../../assets/settings-examples/project-selector.png"),
      width: 304,
      height: 110,
      arrows: [{ fromX: 245, fromY: 103, toX: 277, toY: 83 }],
    },
  ],
  sidebarActivityChips: [
    {
      id: "project-header",
      source: require("../../assets/settings-examples/project-header.png"),
      width: 319,
      height: 56,
      arrows: [{ fromX: 220, fromY: 52, toX: 262, toY: 35 }],
    },
  ],
  sidebarProjectEmphasis: [
    {
      id: "project-header",
      source: require("../../assets/settings-examples/project-header.png"),
      width: 319,
      height: 56,
      arrows: [{ fromX: 112, fromY: 52, toX: 80, toY: 35 }],
    },
  ],
  sidebarBulkActions: [
    {
      id: "bulk-actions",
      source: require("../../assets/settings-examples/bulk-actions.png"),
      width: 312,
      height: 58,
      arrows: [
        { fromX: 222, fromY: 55, toX: 235, toY: 38 },
        { fromX: 276, fromY: 55, toX: 265, toY: 38 },
      ],
    },
  ],
  projectPinning: [
    {
      id: "project-pin",
      source: require("../../assets/settings-examples/project-pin.png"),
      width: 276,
      height: 222,
      arrows: [{ fromX: 249, fromY: 91, toX: 164, toY: 109 }],
    },
  ],
  sidebarWorkspaceTransitions: [
    {
      id: "workspace-positions-before",
      source: require("../../assets/settings-examples/workspace-positions-before.png"),
      width: 312,
      height: 183,
      label: "before",
      arrows: [{ fromX: 212, fromY: 133, toX: 114, toY: 98 }],
    },
    {
      id: "workspace-positions-after",
      source: require("../../assets/settings-examples/workspace-positions-after.png"),
      width: 312,
      height: 183,
      label: "after",
      arrows: [{ fromX: 212, fromY: 92, toX: 114, toY: 60 }],
    },
  ],
};

/** Shared Explorer/Changes output does not demonstrate every automatic preference trigger. */
export const EXPLORER_EXAMPLE_IMAGES: readonly SettingsExampleImage[] = [
  {
    id: "explorer-changes-list",
    source: require("../../assets/settings-examples/explorer-changes-list.png"),
    width: 321,
    height: 152,
    arrows: [{ fromX: 225, fromY: 151, toX: 172, toY: 125 }],
  },
  {
    id: "explorer-changes-diff",
    source: require("../../assets/settings-examples/explorer-changes-diff.png"),
    width: 650,
    height: 100,
    arrows: [{ fromX: 399, fromY: 93, toX: 291, toY: 77 }],
  },
];

/** Actual settings controls from the complete current overview. These do not illustrate list behavior. */
export const WORKSPACE_LIMIT_EXAMPLE_IMAGES = {
  mode: [
    {
      id: "workspace-limit-mode",
      source: require("../../assets/settings-examples/workspace-limit-mode.png"),
      width: 120,
      height: 47,
    },
  ],
  count: [
    {
      id: "workspace-limit-count",
      source: require("../../assets/settings-examples/workspace-limit-count.png"),
      width: 291,
      height: 48,
    },
  ],
} satisfies Record<"mode" | "count", readonly SettingsExampleImage[]>;

/** Point to the part configured by an existing Explorer row, using the same shared genuine screenshots. */
export function getExplorerExampleImages(setting: string): readonly SettingsExampleImage[] {
  let arrows = EXPLORER_EXAMPLE_IMAGES[0].arrows;
  if (setting === "workingDiffDefaultComparison" || setting === "workingDiffAutoSwitch") {
    arrows = [{ fromX: 225, fromY: 65, toX: 127, toY: 89 }];
  } else if (setting === "autoOpenExplorerSidebar") {
    arrows = [{ fromX: 246, fromY: 55, toX: 139, toY: 22 }];
  }
  return [{ ...EXPLORER_EXAMPLE_IMAGES[0], arrows }, EXPLORER_EXAMPLE_IMAGES[1]];
}
