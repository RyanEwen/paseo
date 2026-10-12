import type { StreamItem } from "@/types/stream";

export interface NativeLiveRowGeometry {
  y: number;
  height: number;
}

/** Resolve native reading from FlatList viewability plus the measured upright live-header
 * cell. Inversion reverses cell placement, not the child's coordinates inside that cell.
 */
export function resolveNativeReadingPosition(input: {
  visibleHistory: readonly { item: StreamItem; index: number | null; isViewable: boolean }[];
  liveHead: readonly StreamItem[];
  liveGeometry: ReadonlyMap<string, NativeLiveRowGeometry>;
  headerHeight: number | null;
  viewportHeight: number;
  offsetY: number;
}) {
  const history = input.visibleHistory
    .filter((token) => token.isViewable)
    .toSorted((a, b) => (b.index ?? 0) - (a.index ?? 0));
  const visibleUserIds = history
    .filter((token) => token.item.kind === "user_message")
    .map((token) => token.item.id);
  let rowId = history[0]?.item.id ?? null;
  if (input.headerHeight !== null) {
    const topInHeader = input.headerHeight - input.viewportHeight - input.offsetY;
    for (const item of input.liveHead) {
      const geometry = input.liveGeometry.get(item.id);
      if (
        item.kind === "user_message" &&
        geometry &&
        geometry.y + geometry.height > topInHeader &&
        geometry.y < topInHeader + input.viewportHeight
      )
        visibleUserIds.push(item.id);
    }
    if (topInHeader >= 0) {
      rowId =
        input.liveHead.find((item) => {
          const geometry = input.liveGeometry.get(item.id);
          return geometry && geometry.y + geometry.height > topInHeader;
        })?.id ?? rowId;
    }
  }
  return { rowId, visibleUserIds };
}

/** Convert a live child position to the same visual top alignment as native history jumps. */
export function resolveNativeLivePromptOffset(
  headerHeight: number,
  viewportHeight: number,
  rowY: number,
): number {
  return Math.max(0, headerHeight - viewportHeight - rowY);
}
