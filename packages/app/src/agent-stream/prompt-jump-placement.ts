/** Arrow navigation pins the destination; content reveal and other navigation show its original. */
export type PromptJumpPlacement = "original" | "pinned";

/** Keep pinned geometry beyond the edge even with the controller's one-pixel tolerance.
 * Insets describe measured bubble tops for pinned landings, never estimated row geometry.
 */
export function resolvePromptJumpInset(placement: PromptJumpPlacement = "original"): number {
  return placement === "pinned" ? -2 : 8;
}
