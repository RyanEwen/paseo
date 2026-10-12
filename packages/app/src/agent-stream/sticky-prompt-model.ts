import type { StreamItem } from "@/types/stream";
import type { ChatOutlinePrompt } from "./chat-outline/model";

export type UserPrompt = Extract<StreamItem, { kind: "user_message" }>;
export interface PromptTarget {
  key: string;
  seq?: number;
  item?: UserPrompt;
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

/** Initial latest-prompt discovery belongs to the page owner; manual reads preserve its window. */
export function getMissingReadingPromptSeq(input: {
  navigating: boolean;
  intentional: boolean;
  pending: boolean;
  target?: PromptTarget;
  latest?: PromptTarget;
  selected?: UserPrompt;
}): number | undefined {
  if (!input.intentional || input.navigating || input.pending || input.target?.item)
    return undefined;
  if (input.target?.key === input.latest?.key && !input.selected) return undefined;
  return input.target?.seq;
}

/** Never show a copy while its original user bubble still intersects the viewport. */
export function isStickyPromptVisible(
  message: UserPrompt | undefined,
  target: PromptTarget | undefined,
  visibleIds: readonly string[],
  rowId: string | null,
): boolean {
  return rowId !== null && !!message && !!target && !visibleIds.includes(message.id);
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
