import type { PromptReadingPosition } from "./prompt-reading-position";
import type { StreamItem } from "@/types/stream";
import type { ChatOutlinePrompt } from "./chat-outline/model";

export type UserPrompt = Extract<StreamItem, { kind: "user_message" }>;
export interface PromptTarget {
  key: string;
  seq?: number;
  item?: UserPrompt;
  /** Cache content is not proof that the original row is loaded. */
  cached?: boolean;
}

/** Merge the complete daemon index with loaded prompts, including local submissions. */
export function buildPromptTargets(
  items: readonly StreamItem[],
  prompts: readonly ChatOutlinePrompt[],
  epoch: string | null,
): PromptTarget[] {
  const targets: PromptTarget[] = prompts.map(({ seq }) => ({ key: `${epoch}:${seq}`, seq }));
  const bySeq = new Map(targets.map((target) => [target.seq, target]));
  const loadedIds = new Set<string>();
  for (const item of items) {
    if (item.kind !== "user_message" || loadedIds.has(item.id)) continue;
    loadedIds.add(item.id);
    const seq = item.timelineCursor?.epoch === epoch ? item.timelineCursor?.seq : undefined;
    const indexed = seq === undefined ? undefined : bySeq.get(seq);
    if (indexed) {
      indexed.item = item;
    } else {
      targets.push({ key: seq === undefined ? item.id : `${epoch}:${seq}`, seq, item });
    }
  }
  // Unpositioned local submissions follow authoritative history in submission order.
  return targets.sort((left, right) => (left.seq ?? Infinity) - (right.seq ?? Infinity));
}

/** Resolve by durable identity; array offsets change when a page is loaded. */
export function findPromptTarget(targets: readonly PromptTarget[], item: UserPrompt): number {
  return targets.findIndex(
    (target) =>
      target.item?.id === item.id ||
      (item.timelineCursor !== undefined &&
        target.key === `${item.timelineCursor.epoch}:${item.timelineCursor.seq}`),
  );
}

/** Loading a served index or discovering history blocks duplicate navigation actions. */
export function isPromptNavigationBusy(input: {
  pending: boolean;
  jumping: boolean;
  discovering: boolean;
  indexed: boolean;
  epoch: string | null;
  cancelled: boolean;
  indexReady: boolean;
  indexError: boolean;
}): boolean {
  if (input.pending || input.jumping || input.discovering) return true;
  return (
    input.indexed &&
    input.epoch !== null &&
    !input.indexReady &&
    !input.indexError &&
    !input.cancelled
  );
}

/** Only a complete prompt index or exhausted pagination can establish the oldest bound. */
export function isPreviousPromptDisabled(input: {
  message: UserPrompt | undefined;
  indexed: boolean;
  position: number;
  hasOlder: boolean;
  indexReady: boolean;
  indexError: boolean;
}): boolean {
  if (!input.message || (input.indexed && !input.indexReady)) return true;
  const oldestKnown = input.indexed ? input.indexReady : !input.hasOlder;
  return input.position <= 0 && oldestKnown && !input.indexError;
}

/** Find the user turn at the reading edge, including indexed prompts outside the window. */
export function resolveReadingPromptTarget(
  items: readonly StreamItem[],
  targets: readonly PromptTarget[],
  rowId: string | null,
  readingSeq?: number | null,
): PromptTarget | undefined {
  const row = items.find((item) => item.id === rowId);
  const seq = readingSeq ?? row?.timelineCursor?.seq;
  if (seq !== undefined)
    return targets.findLast((target) => target.seq !== undefined && target.seq <= seq);
  const index = items.findIndex((item) => item.id === rowId);
  const user = items
    .slice(0, index + 1)
    .findLast((item): item is UserPrompt => item.kind === "user_message");
  return user ? targets.find((target) => target.item?.id === user.id) : undefined;
}

/** Resolve passive indexed content through the cache, including initial latest content. */
export function getMissingReadingPromptSeq(input: {
  navigating: boolean;
  intentional: boolean;
  indexed?: boolean;
  cancelled?: boolean;
  pending: boolean;
  target?: PromptTarget;
  latest?: PromptTarget;
  selected?: UserPrompt;
}): number | undefined {
  if (input.navigating || input.pending) return undefined;
  if (!input.intentional) {
    if (input.indexed && !input.cancelled && !input.selected && !input.latest?.item)
      return input.latest?.seq;
    return undefined;
  }
  if (input.target?.item) return undefined;
  return input.target?.seq;
}

/** Paint the pinned prefix only after its original bubble reaches the viewport edge. */
export function isStickyPromptVisible(
  message: UserPrompt | undefined,
  target: PromptTarget | undefined,
  rowId: string | null,
  progress: number,
): boolean {
  return rowId !== null && !!message && !!target && progress > 0;
}

/** Discovery may also begin before the first loaded user message exists. */
export function shouldDiscoverPrompt(
  previous: boolean,
  indexed: boolean,
  message: UserPrompt | undefined,
  cancelled: boolean,
  readingMissing: boolean,
): boolean {
  return previous || (!indexed && !cancelled && (!message || readingMissing));
}

/** The complete target order establishes the newer bound, including unloaded indexed prompts. */
export function isNextPromptDisabled(
  message: UserPrompt | undefined,
  position: number,
  count: number,
): boolean {
  return !message || position < 0 || position >= count - 1;
}

/** An index-free response can precede every loaded prompt; discover its own earlier prompt. */
export function needsReadingPromptDiscovery(
  indexed: boolean,
  manual: boolean,
  rowId: string | null,
  target: PromptTarget | undefined,
): boolean {
  return !indexed && manual && rowId !== null && target === undefined;
}

/** Keep discovery aimed at its original reading turn while older pages are prepended. */
export function hasDiscoveredPrompt(
  previousMode: boolean,
  previous: PromptTarget | undefined,
  readingMode: boolean,
  target: PromptTarget | undefined,
  message: UserPrompt | undefined,
): boolean {
  if (previousMode) return previous !== undefined;
  if (readingMode) return target !== undefined;
  return message !== undefined;
}

/** A missing active prompt gets discovery feedback instead of an unrelated loaded prompt. */
export function resolveStickyPromptMessage(
  selected: UserPrompt | undefined,
  fetched: UserPrompt | undefined,
  readingMissing: boolean,
  missingSeq: number | undefined,
  canFetch: boolean,
): UserPrompt | undefined {
  if (readingMissing) return undefined;
  if (missingSeq !== undefined && canFetch) return fetched;
  return selected;
}

/** The compact copy owns the leading pixels once the original bubble reaches the top. */
export function resolveStickyPromptProgress(
  message: UserPrompt | undefined,
  reading: PromptReadingPosition,
): number {
  if (!message || reading.rowId === null) return 0;
  const handoff = reading.userHandoffs?.find((value) => value.id === message.id);
  if (handoff) return handoff.progress;
  return reading.visibleUserIds.includes(message.id) ? 0 : 1;
}

/** Clip the older overlay where the next original prompt enters. This gives the newer
 * bubble precedence on every platform without changing virtualized row stacking contexts.
 */
export function resolvePromptOcclusionTop(
  targets: readonly PromptTarget[],
  position: number,
  reading: PromptReadingPosition,
): number | undefined {
  const laterIds = new Set(
    targets.slice(position + 1).flatMap((target) => (target.item ? [target.item.id] : [])),
  );
  const tops = (reading.userHandoffs ?? [])
    .filter((value) => laterIds.has(value.id) && value.top !== undefined && value.top >= 0)
    .map((value) => value.top!);
  return tops.length ? Math.min(...tops) : undefined;
}

/** Accept only real source-bubble measurements; unknown/index-only prompts retain the rail. */
export function resolvePromptGeometry(
  frame: import("./prompt-handoff").PromptHandoff | undefined,
  viewportWidth?: number | null,
) {
  if (
    frame?.left === undefined ||
    frame.width === undefined ||
    frame.viewportWidth === undefined ||
    frame.width <= 0 ||
    frame.viewportWidth <= 0
  )
    return undefined;
  if (viewportWidth && frame.viewportWidth !== viewportWidth) return undefined;
  return {
    id: frame.id,
    left: frame.left,
    width: frame.width,
    viewportWidth: frame.viewportWidth,
    prefixHeightOne: frame.prefixHeightOne,
    prefixHeightTwo: frame.prefixHeightTwo,
  };
}

/** Resolve a visible canonical source without conflating repeated provider message IDs. */
export function resolveContextSource(
  items: readonly StreamItem[],
  epoch: string | null,
  rowId: string | null,
  seq: number | null | undefined,
  requested = true,
): StreamItem | undefined {
  if (!requested) return undefined;
  const candidates = items.filter(
    (item) =>
      item.timelineCursor?.epoch === epoch &&
      (seq != null ? item.timelineCursor.seq === seq : item.id === rowId),
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

/** Add cached content to navigation order without claiming the original row is loaded. */
export function mergeCachedPromptTarget(
  targets: PromptTarget[],
  fetched: UserPrompt | undefined,
  selected: UserPrompt | null,
  epoch: string | null,
): PromptTarget[] {
  const cached = fetched ?? selected;
  if (!cached || findPromptTarget(targets, cached) !== -1) return targets;
  const seq = cached.timelineCursor?.epoch === epoch ? cached.timelineCursor.seq : undefined;
  if (seq === undefined) return targets;
  return [...targets, { key: `${epoch}:${seq}`, seq, item: cached, cached: true }].sort(
    (a, b) => (a.seq ?? Infinity) - (b.seq ?? Infinity),
  );
}

/** Only manual missing context uses the passive reader; explicit jumps keep their selection. */
export function shouldReadContext(
  enabled: boolean,
  missing: boolean,
  cancelled: boolean,
  navigating: boolean,
  pending: PromptTarget | "previous" | null,
): boolean {
  return enabled && missing && !cancelled && !navigating && pending === null;
}

/** Freeze explicit selection while its original loads; otherwise use the active reading cache. */
export function resolveContextMessage(
  pending: PromptTarget | "previous" | null,
  missing: boolean,
  selected: UserPrompt | undefined,
  fetched: UserPrompt | undefined,
  missingSeq: number | undefined,
  canFetch: boolean,
): UserPrompt | undefined {
  if (pending) return selected;
  if (missing) return fetched;
  return resolveStickyPromptMessage(selected, fetched, false, missingSeq, canFetch);
}

/** Explicit cached-row revelation loads history; passive context never does. */
export function shouldDiscoverCachedPrompt(
  pending: PromptTarget | "previous" | null,
  indexed: boolean,
  message: UserPrompt | undefined,
  cancelled: boolean,
  readingMissing: boolean,
): boolean {
  if (pending !== null && pending !== "previous" && pending.cached) return true;
  return (
    !readingMissing &&
    shouldDiscoverPrompt(pending === "previous", indexed, message, cancelled, false)
  );
}

/** Stop pagination only when the actual original row is loaded, not its cache copy. */
export function hasDiscoveredCachedPrompt(
  pending: PromptTarget | "previous" | null,
  loaded: PromptTarget[],
  previous: PromptTarget | undefined,
  readingMissing: boolean,
  readingTarget: PromptTarget | undefined,
  message: UserPrompt | undefined,
): boolean {
  if (pending !== null && pending !== "previous" && pending.cached)
    return loaded.some((target) => target.key === pending.key && target.item !== undefined);
  return hasDiscoveredPrompt(
    pending === "previous",
    previous,
    readingMissing,
    readingTarget,
    message,
  );
}

/** Missing canonical identity is an actionable error, never a guessed source cursor. */
export function isContextSourceMissing(requested: boolean, source: StreamItem | undefined) {
  return requested && !source;
}

/** A cache-resolved reading prompt can be pinned while its original is outside the loaded window. */
export function resolveStickyReadingTarget(
  target: PromptTarget | undefined,
  targets: readonly PromptTarget[],
  position: number,
) {
  return target ?? targets[position];
}
