import type { StreamRenderSegments } from "./model";

/** A handoff can briefly expose the same stable row in two lanes. The live revision
 * wins, but the actual cell is rendered once with the same canonical key.
 */
export function uniqueStreamSegments(input: StreamRenderSegments): StreamRenderSegments {
  const liveIds = new Set(input.liveHead.map((item) => item.id));
  const mountedIds = new Set(input.historyMounted.map((item) => item.id));
  const seen = new Set<string>();
  const historyVirtualized = input.historyVirtualized.filter((item) => {
    if (liveIds.has(item.id) || mountedIds.has(item.id) || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  const historyMounted = input.historyMounted.filter((item) => {
    if (liveIds.has(item.id) || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  const liveHead = input.liveHead.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  return historyVirtualized.length === input.historyVirtualized.length &&
    historyMounted.length === input.historyMounted.length &&
    liveHead.length === input.liveHead.length
    ? input
    : { historyVirtualized, historyMounted, liveHead };
}

/** Virtual estimates select retention only; they never prove a jump has settled. */
export function precedingPromptIndex(
  userIndices: readonly number[],
  measurements: readonly { start: number }[],
  offset: number,
): number {
  let first = 0;
  let last = userIndices.length - 1;
  let result = -1;
  while (first <= last) {
    const middle = (first + last) >> 1;
    const index = userIndices[middle];
    const frame = measurements[index];
    if (frame && frame.start <= offset) {
      result = index;
      first = middle + 1;
    } else last = middle - 1;
  }
  return result;
}
