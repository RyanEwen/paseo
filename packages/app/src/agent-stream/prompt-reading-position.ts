export interface PromptReadingPosition {
  rowId: string | null;
  seq?: number | null;
  navigating: boolean;
  following: boolean;
  manual: boolean;
  visibleUserIds: readonly string[];
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
    ) {
      if (
        snapshot.seq === seq &&
        snapshot.manual === manual &&
        snapshot.following === following &&
        snapshot.navigating === navigating &&
        snapshot.rowId === rowId &&
        snapshot.visibleUserIds.length === visibleUserIds.length &&
        snapshot.visibleUserIds.every((id, index) => id === visibleUserIds[index])
      )
        return;
      snapshot = { rowId, seq, visibleUserIds, navigating, following, manual };
      for (const listener of listeners) listener();
    },
  };
}

export const EMPTY_PROMPT_READING_SOURCE: PromptReadingSource = createPromptReadingPublisher();
