import { MIN_SPLIT_SIZE } from "@/stores/workspace-layout-constants";
import { computeResizeHandleSizes } from "./resize-handle-sizes";

/** Ratios read left-to-right for columns and top-to-bottom for rows. */
export const SPLIT_LAYOUT_PRESETS = [
  { label: "50/50", fraction: 0.5 },
  { label: "60/40", fraction: 0.6 },
  { label: "40/60", fraction: 0.4 },
  { label: "70/30", fraction: 0.7 },
  { label: "30/70", fraction: 0.3 },
] as const;

export type SplitSide = "left" | "right" | "top" | "bottom";

/** Preserve the adjacent pair's total and every other pane while honoring the normal drag minimum. */
export function applySplitLayoutPreset(sizes: number[], index: number, fraction: number): number[] {
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction >= 1) return sizes.slice();
  const first = sizes[index];
  const second = sizes[index + 1];
  if (first === undefined || second === undefined) return sizes.slice();
  return computeResizeHandleSizes({
    sizes,
    index,
    deltaRatio: (first + second) * fraction - first,
  });
}

/** Disable choices that cannot fit beside this divider rather than silently selecting a different ratio. */
export function canApplySplitLayoutPreset(
  sizes: number[],
  index: number,
  fraction: number,
): boolean {
  const first = sizes[index];
  const second = sizes[index + 1];
  if (
    first === undefined ||
    second === undefined ||
    !Number.isFinite(fraction) ||
    fraction <= 0 ||
    fraction >= 1
  )
    return false;
  const pair = first + second;
  if (!Number.isFinite(pair) || pair <= 0) return false;
  const minimum = Math.min(MIN_SPLIT_SIZE, pair / 2);
  return pair * fraction >= minimum - 1e-9 && pair * (1 - fraction) >= minimum - 1e-9;
}
