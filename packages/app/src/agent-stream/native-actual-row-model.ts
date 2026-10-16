import type { StreamRenderSegments } from "./model";
import { uniqueStreamSegments } from "./actual-row-collection";
/** Raw chronological content coordinates. Keyboard motion K cancels from bottom
 * distance; it changes the visible leading edge, never H or the content offset. */
export function nativeBottomDistance(
  height: number,
  bottomInset: number,
  viewport: number,
  offset: number,
) {
  return Math.max(0, height + bottomInset - viewport - offset);
}
export function nativeJumpOffset(offset: number, top: number, inset: number, maximum: number) {
  return Math.max(0, Math.min(maximum, offset + top - inset));
}
/** Match RN 0.81.5's forward sticky interpolation, including an unknown next cell. */
export function nativeStickyTranslation(
  y: number,
  layout: number,
  height: number,
  next: number | null,
) {
  "worklet";
  const collision = (next ?? 0) - height;
  const translated = Math.max(0, y - layout);
  return collision >= layout ? Math.min(translated, collision - layout) : translated;
}

export function nativeOriginalTop(
  layout: number,
  offset: number,
  listTop: number,
  clipTop: number,
) {
  return layout - offset + listTop - Math.max(clipTop, listTop);
}

/** Canonical IDs are the one list-cell key across all former rendering lanes. */
export function nativeChronologicalRows(segments: StreamRenderSegments) {
  const unique = uniqueStreamSegments(segments);
  return [...unique.historyVirtualized, ...unique.historyMounted, ...unique.liveHead];
}

export interface ActualNativeRowGeometry {
  index: number;
  y: number;
  height: number;
}
interface ActualNativeReadingInput {
  items: readonly import("@/types/stream").StreamItem[];
  geometry: ReadonlyMap<string, ActualNativeRowGeometry>;
  mounted: ReadonlySet<string>;
  offset: number;
  viewportHeight: number;
  clippedLeading: number;
  stickyEnabled: boolean;
}
function collectOriginalNativeRows(
  input: ActualNativeReadingInput,
  leading: number,
  trailing: number,
) {
  let pinnedIndex = -1;
  const originalVisible: number[] = [];
  for (const [index, item] of input.items.entries()) {
    const row = input.geometry.get(item.id);
    if (!input.mounted.has(item.id) || row?.index !== index || !(row.height > 0)) continue;
    if (input.stickyEnabled && item.kind === "user_message" && row.y <= leading)
      pinnedIndex = index;
    if (row.y < trailing && row.y + row.height > leading) originalVisible.push(index);
  }
  return { pinnedIndex, originalVisible };
}
function nextNativeHeaderTop(input: ActualNativeReadingInput, pinnedIndex: number) {
  for (let index = pinnedIndex + 1; index < input.items.length; index += 1) {
    const item = input.items[index];
    const geometry = input.geometry.get(item.id);
    if (item.kind === "user_message" && geometry?.index === index) return geometry.y;
  }
  return null;
}
function retainedNativePromptIsVisible(
  input: ActualNativeReadingInput,
  index: number,
  leading: number,
  trailing: number,
) {
  const pinned = input.items[index];
  if (!pinned || !(trailing > leading)) return false;
  const row = input.geometry.get(pinned.id)!;
  const top =
    row.y + nativeStickyTranslation(leading, row.y, row.height, nextNativeHeaderTop(input, index));
  return top < trailing && top + row.height > leading;
}
export function resolveActualNativeReading(input: ActualNativeReadingInput) {
  const leading = input.offset + Math.max(0, input.clippedLeading);
  const trailing = input.offset + input.viewportHeight;
  const { pinnedIndex, originalVisible } = collectOriginalNativeRows(input, leading, trailing);
  const pinned = input.items[pinnedIndex];
  const pinnedVisible = retainedNativePromptIsVisible(input, pinnedIndex, leading, trailing);
  const visibleIndices = trailing > leading ? [...originalVisible] : [];
  if (pinnedVisible && !visibleIndices.includes(pinnedIndex)) visibleIndices.push(pinnedIndex);
  visibleIndices.sort((left, right) => left - right);
  let first = trailing > leading ? input.items[originalVisible[0]] : undefined;
  if (!first && pinnedVisible) first = pinned;
  return {
    pinnedId: pinnedVisible ? pinned.id : null,
    rowId: first?.id ?? null,
    seq: first?.timelineCursor?.seq ?? null,
    visibleUserIds: visibleIndices
      .filter((index) => input.items[index].kind === "user_message")
      .map((index) => input.items[index].id),
  };
}

/** Only the explicitly standalone child topology may omit BOTH dock contracts. */
export function resolveNativeMotionOwner(
  allowStandalone: boolean,
  hasMotion: boolean,
  hasStationaryClip: boolean,
): "docked" | "standalone" {
  if (hasMotion && hasStationaryClip) return "docked";
  if (allowStandalone && !hasMotion && !hasStationaryClip) return "standalone";
  throw new Error("Native transcript motion and stationary viewport owners must match");
}
export function resolveNativeMeasurementOwner<T>(
  mode: "docked" | "standalone",
  viewport: T | null,
  stationaryClip: T | null,
) {
  if (!viewport) return null;
  const clip = mode === "standalone" ? viewport : stationaryClip;
  return clip ? { viewport, clip } : null;
}
