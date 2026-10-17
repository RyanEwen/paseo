export interface PromptHandoff {
  id: string;
  /** Exclusive ownership: zero before the bubble reaches the edge, one once pinned. */
  progress: number;
  top?: number;
  /** Actual bubble geometry in viewport pixels, including its original wrapping width. */
  left?: number;
  width?: number;
  height?: number;
  viewportWidth?: number;
  prefixHeightOne?: number;
  prefixHeightTwo?: number;
}

/** Pin at the original bubble's edge. There is no interval with two translucent copies. */
export function resolvePromptHandoffProgress(top: number): number {
  return top <= 0 ? 1 : 0;
}
