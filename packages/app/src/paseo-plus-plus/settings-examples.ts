import type { SettingsExampleImage } from "@/components/settings/settings-example";
import type { PaseoPlusPlusFeature } from "./preferences";

/** Original app captures with contextual display frames. Android checks have text help only. */
export const FEATURE_EXAMPLE_IMAGES: Partial<
  Record<PaseoPlusPlusFeature | "descriptiveToolCalls", readonly SettingsExampleImage[]>
> = {
  descriptiveToolCalls: [
    {
      id: "descriptive-tool-calls",
      source: require("../../assets/settings-examples/descriptive-tool-calls.png"),
      width: 1280,
      height: 900,
      viewport: { left: 384, top: 386, width: 500, height: 364 },
      outlines: [{ left: -2, top: 34, width: 836, height: 38, radius: 12 }],
    },
  ],
  previousAgents: [
    {
      id: "previous-agents",
      source: require("../../assets/settings-examples/previous-agents.png"),
      width: 1440,
      height: 900,
      viewport: { left: 320, top: 0, width: 400, height: 400 },
      outlines: [{ left: 178, top: 104, width: 192, height: 28 }],
    },
  ],
  sidebarProjectSelector: [
    {
      id: "project-selector",
      source: require("../../assets/settings-examples/project-selector.png"),
      width: 1440,
      height: 900,
      viewport: { left: 0, top: 125, width: 320, height: 270 },
    },
  ],
  sidebarActivityChips: [
    {
      id: "project-header",
      source: require("../../assets/settings-examples/project-header.png"),
      width: 1440,
      height: 900,
      viewport: { left: 0, top: 125, width: 320, height: 270 },
      arrows: [{ fromX: 184, fromY: 134, toX: 244, toY: 175 }],
    },
  ],
  sidebarProjectEmphasis: [
    {
      id: "project-header",
      source: require("../../assets/settings-examples/project-header.png"),
      width: 1440,
      height: 900,
      viewport: { left: 0, top: 125, width: 320, height: 270 },
    },
  ],
  sidebarBulkActions: [
    {
      id: "bulk-actions",
      source: require("../../assets/settings-examples/bulk-actions.png"),
      width: 1440,
      height: 900,
      viewport: { left: 0, top: 125, width: 320, height: 270 },
      outlines: [{ left: 226, top: 14, width: 52, height: 28 }],
    },
  ],
  projectPinning: [
    {
      id: "project-pin",
      source: require("../../assets/settings-examples/project-pin.png"),
      width: 1440,
      height: 900,
      viewport: { left: 0, top: 125, width: 344, height: 452 },
      outlines: [{ left: 74, top: 319, width: 245, height: 27 }],
    },
  ],
};

/** Shared preference help slots stay empty until genuine captures are qualified. */
export const PREFERENCE_EXAMPLE_IMAGES: Partial<
  Record<"explorer" | "workspaceLimit", readonly SettingsExampleImage[]>
> = {};
