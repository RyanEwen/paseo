import { resolvePromptHandoffProgress, type PromptHandoff } from "./prompt-handoff";

export interface NativePromptWindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
  prefixHeightOne?: number;
  prefixHeightTwo?: number;
}

/** Sample actual bubble and viewport window rectangles. Changing targets invalidates old
 * callbacks; same-target samples can finish out of order without starving during scroll.
 * Non-positive retained-pane geometry never replaces a valid presentation measurement.
 */
export function createNativePromptHandoffSampler(ports: {
  measureViewport(callback: (rect: NativePromptWindowRect | null) => void): void;
  measurePrompt(id: string, callback: (rect: NativePromptWindowRect | null) => void): void;
  onMeasured(frame: PromptHandoff): void;
}) {
  let target: string | null = null;
  let generation = 0;
  let request = 0;
  let completed = 0;
  return {
    cancel() {
      target = null;
      generation += 1;
    },
    sample(id: string) {
      if (target !== id) {
        target = id;
        generation += 1;
      }
      const owner = generation;
      const sequence = ++request;
      ports.measureViewport((viewport) => {
        if (owner !== generation || !viewport || viewport.width <= 0 || viewport.height <= 0)
          return;
        ports.measurePrompt(id, (bubble) => {
          if (
            owner !== generation ||
            sequence < completed ||
            !bubble ||
            bubble.width <= 0 ||
            bubble.height <= 0 ||
            // Layout events can arrive after the public rectangle callback. Never
            // publish a visible copy before the source prefix can be covered.
            bubble.prefixHeightOne === undefined ||
            bubble.prefixHeightTwo === undefined
          )
            return;
          completed = sequence;
          const top = bubble.y - viewport.y;
          ports.onMeasured({
            id,
            progress: resolvePromptHandoffProgress(top),
            top,
            left: bubble.x - viewport.x,
            width: bubble.width,
            height: bubble.height,
            viewportWidth: viewport.width,
            prefixHeightOne: bubble.prefixHeightOne,
            prefixHeightTwo: bubble.prefixHeightTwo,
          });
        });
      });
    },
  };
}

/** Bound work to the leading original and its approaching replacement, each with its own
 * callback ordering and cancellation fences. Both slots measure the real bubble, not a cell.
 */
export function createNativePromptHandoffPair(
  ports: Parameters<typeof createNativePromptHandoffSampler>[0],
) {
  const slots = [createNativePromptHandoffSampler(ports), createNativePromptHandoffSampler(ports)];
  return {
    cancel() {
      for (const slot of slots) slot.cancel();
    },
    sample(ids: readonly string[]) {
      slots.forEach((slot, index) => {
        const id = ids[index];
        if (id) slot.sample(id);
        else slot.cancel();
      });
    },
  };
}
