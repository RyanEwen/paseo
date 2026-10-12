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
