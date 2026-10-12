/** The original and compact copy overlap for this short scroll distance, before the
 * original has left view. Progress follows scrolling in either direction, without timers.
 */
export const PROMPT_HANDOFF_DISTANCE = 48;

export interface PromptHandoff {
  id: string;
  progress: number;
  /** Original visual top in viewport pixels, including upcoming prompts. */
  top?: number;
}

/** Convert the original bubble's visual top relative to the viewport into its handoff. */
export function resolvePromptHandoffProgress(top: number): number {
  return Math.min(1, Math.max(0, -top / PROMPT_HANDOFF_DISTANCE));
}
