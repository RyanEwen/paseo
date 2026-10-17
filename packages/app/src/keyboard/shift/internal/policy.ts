export const DEFAULT_IOS_KEYBOARD_INSET_MIN_HEIGHT = 120;

/** Reserve both endpoints during motion so content cannot grow into a closing IME. */
export function reserveKeyboardLayoutShift(input: {
  current: number;
  target: number;
  phase: "start" | "end";
}): number {
  "worklet";
  return input.phase === "start" ? Math.max(input.current, input.target) : input.target;
}

export function resolveStreamKeyboardInset(input: {
  platform: "android" | "ios";
  settledShift: number;
}): {
  contentContainerPaddingBottom: number;
  contentInset: { bottom: number } | undefined;
} {
  const settledShift = Math.max(0, input.settledShift);
  if (input.platform === "ios") {
    return {
      contentContainerPaddingBottom: 0,
      contentInset: { bottom: settledShift },
    };
  }
  return {
    contentContainerPaddingBottom: settledShift,
    contentInset: undefined,
  };
}

export function shouldUseCompactExplorerKeyboardPadding(input: {
  isGit: boolean;
  explorerTab: "changes" | "files" | "pr";
}): boolean {
  return !input.isGit || input.explorerTab !== "changes";
}

export function resolveKeyboardShift(input: {
  rawKeyboardHeight: number;
  keyboardProgress: number;
  bottomInset: number;
  isIos: boolean;
  iosMinHeight: number;
}): number {
  "worklet";

  if (!(input.keyboardProgress > 0) || !(input.rawKeyboardHeight > 0)) {
    return 0;
  }

  // iOS can report a small accessory/prediction bar height during touch focus.
  // Treat that as non-keyboard so layouts don't "bounce" while interacting.
  if (input.isIos && input.rawKeyboardHeight < input.iosMinHeight) {
    return 0;
  }

  return Math.max(0, input.rawKeyboardHeight - input.bottomInset);
}

export function shouldReconcileHiddenKeyboardEnd(input: {
  height: number;
  progress: number;
}): boolean {
  "worklet";
  return !(input.height > 0) || !(input.progress > 0);
}

/** Physical translated dock endpoint: unlike app keyboard policy, accessory bars
 * below 120px still displace the iOS graph and must reserve their actual extent. */
export function resolveDockReservation(
  height: number,
  progress: number,
  bottomInset: number,
  clearance: number,
): number {
  "worklet";
  return progress > 0 ? Math.max(0, Math.abs(height) - bottomInset * progress - clearance) : 0;
}

export interface DockReservationSnapshot {
  extent: number;
  settledRevision: number;
}
export function updateDockReservation(
  snapshot: DockReservationSnapshot,
  target: number,
  phase: "start" | "end",
) {
  const extent = reserveKeyboardLayoutShift({ current: snapshot.extent, target, phase });
  if (phase === "start" && extent === snapshot.extent) return snapshot;
  return { extent, settledRevision: snapshot.settledRevision + (phase === "end" ? 1 : 0) };
}
