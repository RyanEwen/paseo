import { describe, expect, it } from "vitest";
import {
  MIN_WORKSPACE_TAB_WIDTH,
  computeWorkspaceTabLayout,
  retainWorkspaceTabMeasuredWidth,
  resolveWorkspaceTabScrollOffset,
} from "@/screens/workspace/workspace-tab-layout";

const metrics = {
  rowHorizontalInset: 0,
  actionsReservedWidth: 120,
  rowPaddingHorizontal: 8,
  tabGap: 4,
  minTabWidth: 64,
  maxTabWidth: 160,
  tabIconWidth: 14,
  tabContentGap: 4,
  tabHorizontalPadding: 8,
  closeButtonWidth: 0,
};

describe("computeWorkspaceTabLayout", () => {
  it("keeps short desktop tab names at the fork minimum width", () => {
    const result = computeWorkspaceTabLayout({
      viewportWidth: 1200,
      tabLabelWidths: [0, 29, 52, 400],
      metrics: { ...metrics, minTabWidth: MIN_WORKSPACE_TAB_WIDTH },
    });
    expect(result.items.map((item) => item.width)).toEqual([96, 96, 96, 160]);
    expect(result.requiresHorizontalScrollFallback).toBe(false);
  });
  it("scrolls instead of shrinking desktop tabs below the fork minimum", () => {
    const result = computeWorkspaceTabLayout({
      viewportWidth: 260,
      tabLabelWidths: [29, 52, 180],
      metrics: { ...metrics, minTabWidth: MIN_WORKSPACE_TAB_WIDTH },
    });
    expect(result.items.map((item) => item.width)).toEqual([96, 96, 96]);
    expect(result.requiresHorizontalScrollFallback).toBe(true);
    expect(result.items.every((item) => item.showLabel)).toBe(true);
  });

  it("raises the title ceiling by 50% without stretching short tabs", () => {
    const normal = computeWorkspaceTabLayout({
      viewportWidth: 1200,
      tabLabelWidths: [30, 400],
      metrics,
    });
    const wider = computeWorkspaceTabLayout({
      viewportWidth: 1200,
      tabLabelWidths: [30, 400],
      metrics,
      widerTabs: true,
    });
    expect(normal.items.map((item) => item.width)).toEqual([64, 160]);
    expect(wider.items.map((item) => item.width)).toEqual([64, 240]);
  });

  it("uses the compact ceiling and preserves scrolling when wider tabs are enabled", () => {
    const result = computeWorkspaceTabLayout({
      viewportWidth: 390,
      tabLabelWidths: [400, 400],
      metrics: { ...metrics, minTabWidth: 120, maxTabWidth: 240 },
      widerTabs: true,
      preserveNaturalWidths: true,
    });
    expect(result.items.map((item) => item.width)).toEqual([360, 360]);
    expect(result.requiresHorizontalScrollFallback).toBe(true);
    expect(result.closeButtonPolicy).toBe("all");
  });

  it("still compresses wider desktop tabs to fit the available pane", () => {
    const result = computeWorkspaceTabLayout({
      viewportWidth: 400,
      tabLabelWidths: [400, 400],
      metrics,
      widerTabs: true,
    });
    expect(result.items.map((item) => item.width)).toEqual([130, 130]);
    expect(result.requiresHorizontalScrollFallback).toBe(false);
  });

  it("restores the earlier ceiling when the preference is disabled", () => {
    const input = { viewportWidth: 1200, tabLabelWidths: [400], metrics };
    expect(computeWorkspaceTabLayout({ ...input, widerTabs: false })).toEqual(
      computeWorkspaceTabLayout(input),
    );
  });

  it("keeps each tab at its natural content width when space is available", () => {
    const result = computeWorkspaceTabLayout({
      viewportWidth: 1200,
      tabLabelWidths: [56, 70, 49],
      metrics,
    });

    expect(result.closeButtonPolicy).toBe("all");
    expect(result.requiresHorizontalScrollFallback).toBe(false);
    expect(result.items).toHaveLength(3);
    expect(result.items.every((item) => item.showLabel)).toBe(true);
    expect(result.items.map((item) => item.width)).toEqual([90, 104, 83]);
  });

  it("lets short labels use their content width below the old 96px floor", () => {
    const result = computeWorkspaceTabLayout({
      viewportWidth: 300,
      tabLabelWidths: [29, 52],
      metrics: { ...metrics, actionsReservedWidth: 36 },
    });
    expect(result.items).toEqual([
      { width: 64, showLabel: true },
      { width: 86, showLabel: true },
    ]);
    expect(result.requiresHorizontalScrollFallback).toBe(false);
  });

  it("sizes a single tab between the minimum and maximum from its content", () => {
    const result = computeWorkspaceTabLayout({
      viewportWidth: 1200,
      tabLabelWidths: [105],
      metrics,
    });

    expect(result.requiresHorizontalScrollFallback).toBe(false);
    expect(result.items.map((item) => item.width)).toEqual([139]);
  });

  it("shrinks natural widths proportionally without crossing the clickable minimum", () => {
    const result = computeWorkspaceTabLayout({
      viewportWidth: 460,
      tabLabelWidths: [168, 84, 56],
      metrics,
    });

    expect(result.closeButtonPolicy).toBe("all");
    expect(result.requiresHorizontalScrollFallback).toBe(false);
    expect(result.items.map((item) => item.width)).toEqual([132, 102, 82]);
    expect(result.items.every((item) => item.showLabel)).toBe(true);
  });

  it("caps long tabs at the maximum width", () => {
    const result = computeWorkspaceTabLayout({
      viewportWidth: 1004,
      tabLabelWidths: [280, 280, 280, 280],
      metrics: {
        ...metrics,
        actionsReservedWidth: 44,
        rowPaddingHorizontal: 0,
        tabGap: 0,
      },
    });

    expect(result.closeButtonPolicy).toBe("all");
    expect(result.requiresHorizontalScrollFallback).toBe(false);
    expect(result.items.map((item) => item.width)).toEqual([160, 160, 160, 160]);
  });

  it("keeps every tab at the clickable minimum at the exact fit boundary", () => {
    const result = computeWorkspaceTabLayout({
      viewportWidth: 404,
      tabLabelWidths: [98, 98, 98, 98],
      metrics,
    });

    expect(result.closeButtonPolicy).toBe("all");
    expect(result.requiresHorizontalScrollFallback).toBe(false);
    expect(result.items.map((item) => item.width)).toEqual([64, 64, 64, 64]);
    expect(result.items.every((item) => item.showLabel)).toBe(true);
  });

  it("uses horizontal scroll rather than shrinking below the clickable minimum", () => {
    const result = computeWorkspaceTabLayout({
      viewportWidth: 403,
      tabLabelWidths: [98, 98, 98, 98],
      metrics,
    });

    expect(result.closeButtonPolicy).toBe("all");
    expect(result.requiresHorizontalScrollFallback).toBe(true);
    expect(result.items.map((item) => item.width)).toEqual([64, 64, 64, 64]);
    expect(result.items.every((item) => item.showLabel)).toBe(true);
  });

  it("keeps compact labels readable instead of compressing them to fit", () => {
    const result = computeWorkspaceTabLayout({
      viewportWidth: 390,
      tabLabelWidths: [98, 98, 98, 98],
      metrics,
      preserveNaturalWidths: true,
    });
    expect(result.requiresHorizontalScrollFallback).toBe(true);
    expect(result.items).toEqual(
      Array.from({ length: 4 }, () => ({ width: 132, showLabel: true })),
    );

    const rotated = computeWorkspaceTabLayout({
      viewportWidth: 844,
      tabLabelWidths: [98, 98, 98, 98],
      metrics,
      preserveNaturalWidths: true,
    });
    expect(rotated.requiresHorizontalScrollFallback).toBe(false);
    expect(rotated.items).toEqual(result.items);
  });

  it("returns empty layout details when there are no tabs", () => {
    const result = computeWorkspaceTabLayout({
      viewportWidth: 1200,
      tabLabelWidths: [],
      metrics,
    });

    expect(result.closeButtonPolicy).toBe("all");
    expect(result.requiresHorizontalScrollFallback).toBe(false);
    expect(result.items).toEqual([]);
  });

  it("uses rendered label width rather than character count", () => {
    const result = computeWorkspaceTabLayout({
      viewportWidth: 1200,
      tabLabelWidths: [68, 104],
      metrics,
    });

    expect(result.items.map((item) => item.width)).toEqual([102, 138]);
  });
});

describe("retainWorkspaceTabMeasuredWidth", () => {
  it("retains the last usable width while a retained panel is hidden", () => {
    expect(retainWorkspaceTabMeasuredWidth(720, 0)).toBe(720);
  });

  it("accepts the next usable layout width", () => {
    expect(retainWorkspaceTabMeasuredWidth(720, 640)).toBe(640);
  });
});

describe("selected workspace tab visibility", () => {
  const geometry = {
    offset: 0,
    viewportWidth: 300,
    contentWidth: 800,
    tabStart: 440,
    tabWidth: 140,
  };

  it("reveals an offscreen selected or newly opened tab", () => {
    expect(resolveWorkspaceTabScrollOffset(geometry)).toBe(280);
  });

  it("keeps a fully visible selection at the user's current offset", () => {
    expect(resolveWorkspaceTabScrollOffset({ ...geometry, offset: 400 })).toBe(400);
  });

  it("reveals an earlier tab after selecting it", () => {
    expect(resolveWorkspaceTabScrollOffset({ ...geometry, offset: 500 })).toBe(440);
  });

  it("updates visibility after rotation and clamps after closing tabs", () => {
    expect(resolveWorkspaceTabScrollOffset({ ...geometry, viewportWidth: 160 })).toBe(420);
    expect(resolveWorkspaceTabScrollOffset({ ...geometry, offset: 500, contentWidth: 600 })).toBe(
      300,
    );
  });

  it("waits for usable native measurements", () => {
    expect(resolveWorkspaceTabScrollOffset({ ...geometry, viewportWidth: 0 })).toBe(0);
  });
});
