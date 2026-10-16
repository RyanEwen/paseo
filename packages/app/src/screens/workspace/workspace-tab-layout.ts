export const MIN_WORKSPACE_TAB_WIDTH = 96;

export type WorkspaceTabCloseButtonPolicy = "all";

export interface WorkspaceTabLayoutMetrics {
  rowHorizontalInset: number;
  actionsReservedWidth: number;
  rowPaddingHorizontal: number;
  tabGap: number;
  minTabWidth: number;
  maxTabWidth: number;
  tabIconWidth: number;
  tabContentGap: number;
  tabHorizontalPadding: number;
  closeButtonWidth: number;
}

export interface WorkspaceTabLayoutInput {
  viewportWidth: number;
  tabLabelWidths: number[];
  metrics: WorkspaceTabLayoutMetrics;
  /** Compact strips keep readable content widths and scroll instead of compressing tabs. */
  preserveNaturalWidths?: boolean;
  /** Raise only the title-width ceiling; short tabs and overflow behavior stay content-driven. */
  widerTabs?: boolean;
}

export interface WorkspaceTabLayoutItem {
  width: number;
  showLabel: boolean;
}

export interface WorkspaceTabLayoutResult {
  items: WorkspaceTabLayoutItem[];
  closeButtonPolicy: WorkspaceTabCloseButtonPolicy;
  requiresHorizontalScrollFallback: boolean;
}

export function retainWorkspaceTabMeasuredWidth(
  currentWidth: number,
  measuredWidth: number,
): number {
  if (measuredWidth <= 0 || Math.abs(currentWidth - measuredWidth) <= 1) {
    return currentWidth;
  }
  return measuredWidth;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

export function computeWorkspaceTabLayout(
  input: WorkspaceTabLayoutInput,
): WorkspaceTabLayoutResult {
  const tabCount = input.tabLabelWidths.length;
  if (tabCount === 0) {
    return {
      items: [],
      closeButtonPolicy: "all",
      requiresHorizontalScrollFallback: false,
    };
  }

  const availableWidth = Math.max(
    0,
    input.viewportWidth - input.metrics.rowHorizontalInset * 2 - input.metrics.actionsReservedWidth,
  );
  const rowOverhead =
    input.metrics.rowPaddingHorizontal * 2 + Math.max(tabCount - 1, 0) * input.metrics.tabGap;
  const availableTabsWidth = Math.max(0, availableWidth - rowOverhead);
  const tabChromeWidth =
    input.metrics.tabIconWidth +
    input.metrics.tabContentGap +
    input.metrics.tabHorizontalPadding * 2 +
    input.metrics.closeButtonWidth;
  const maximumWidth = input.metrics.maxTabWidth * (input.widerTabs ? 1.5 : 1);
  const naturalWidths = input.tabLabelWidths.map((labelWidth) =>
    clamp(tabChromeWidth + labelWidth, input.metrics.minTabWidth, maximumWidth),
  );
  const naturalTotalWidth = naturalWidths.reduce((total, width) => total + width, 0);
  const minimumTotalWidth = input.metrics.minTabWidth * tabCount;
  const requiresHorizontalScrollFallback = input.preserveNaturalWidths
    ? availableTabsWidth < naturalTotalWidth
    : availableTabsWidth < minimumTotalWidth;

  let resolvedWidths = naturalWidths;
  if (!input.preserveNaturalWidths && requiresHorizontalScrollFallback) {
    resolvedWidths = Array.from({ length: tabCount }, () => input.metrics.minTabWidth);
  } else if (!input.preserveNaturalWidths && naturalTotalWidth > availableTabsWidth) {
    const widthToRemove = naturalTotalWidth - availableTabsWidth;
    const shrinkCapacity = naturalTotalWidth - minimumTotalWidth;
    const shrinkRatio = widthToRemove / shrinkCapacity;
    resolvedWidths = naturalWidths.map(
      (width) => width - (width - input.metrics.minTabWidth) * shrinkRatio,
    );
  }

  const roundedWidths = resolvedWidths.map((width) =>
    Math.round(clamp(width, input.metrics.minTabWidth, maximumWidth)),
  );

  return {
    items: roundedWidths.map((width) => ({
      width,
      showLabel: width > tabChromeWidth,
    })),
    closeButtonPolicy: "all",
    requiresHorizontalScrollFallback,
  };
}

/** Reveal the selected tab with the smallest movement, clamped to the measured scroll range. */
export function resolveWorkspaceTabScrollOffset(input: {
  offset: number;
  viewportWidth: number;
  contentWidth: number;
  tabStart: number;
  tabWidth: number;
}): number {
  const { offset, viewportWidth, contentWidth, tabStart, tabWidth } = input;
  if (viewportWidth <= 0 || contentWidth <= 0) {
    return offset;
  }

  let nextOffset = offset;
  if (tabStart < offset || tabWidth > viewportWidth) {
    nextOffset = tabStart;
  } else if (tabStart + tabWidth > offset + viewportWidth) {
    nextOffset = tabStart + tabWidth - viewportWidth;
  }

  return clamp(nextOffset, 0, Math.max(0, contentWidth - viewportWidth));
}
