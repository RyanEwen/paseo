import type { PromptHandoff } from "./prompt-handoff";

export interface PromptReadingPosition {
  rowId: string | null;
  viewportWidth?: number | null;
  seq?: number | null;
  navigating: boolean;
  following: boolean;
  manual: boolean;
  visibleUserIds: readonly string[];
  userHandoffs?: readonly PromptHandoff[];
}

export interface PromptReadingSource {
  subscribe(listener: () => void): () => void;
  getSnapshot(): PromptReadingPosition;
}

/** Publish viewport ownership without rerendering the transcript on every scroll event. */
export function createPromptReadingPublisher() {
  let snapshot: PromptReadingPosition = {
    rowId: null,
    seq: null,
    userHandoffs: [],
    visibleUserIds: [],
    navigating: false,
    following: false,
    manual: false,
  };
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish(
      rowId: string | null,
      visibleUserIds: readonly string[] = [],
      navigating = false,
      following = false,
      manual = true,
      seq: number | null = null,
      userHandoffs: readonly PromptHandoff[] = [],
      viewportWidth: number | null = null,
    ) {
      if (
        sameHandoffs(snapshot.userHandoffs ?? [], userHandoffs) &&
        snapshot.viewportWidth === viewportWidth &&
        snapshot.seq === seq &&
        snapshot.manual === manual &&
        snapshot.following === following &&
        snapshot.navigating === navigating &&
        snapshot.rowId === rowId &&
        snapshot.visibleUserIds.length === visibleUserIds.length &&
        snapshot.visibleUserIds.every((id, index) => id === visibleUserIds[index])
      )
        return;
      snapshot = {
        rowId,
        seq,
        viewportWidth,
        visibleUserIds,
        userHandoffs,
        navigating,
        following,
        manual,
      };
      for (const listener of listeners) listener();
    },
  };
}

export const EMPTY_PROMPT_READING_SOURCE: PromptReadingSource = createPromptReadingPublisher();

/** Geometry changes only wake the compact surface; unchanged scroll samples are ignored. */
function sameHandoffs(left: readonly PromptHandoff[], right: readonly PromptHandoff[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (value, index) =>
        value.id === right[index]?.id &&
        value.progress === right[index]?.progress &&
        value.top === right[index]?.top &&
        value.left === right[index]?.left &&
        value.width === right[index]?.width &&
        value.height === right[index]?.height &&
        value.viewportWidth === right[index]?.viewportWidth &&
        value.prefixHeightOne === right[index]?.prefixHeightOne &&
        value.prefixHeightTwo === right[index]?.prefixHeightTwo,
    )
  );
}
