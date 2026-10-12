import { resolvePromptHandoffProgress } from "./prompt-handoff";

/** Sample public native window coordinates. Changing targets invalidates old callbacks;
 * samples for the same target may finish out of order without starving during scrolling.
 */
export function createNativePromptHandoffSampler(ports: {
  measureViewport(callback: (y: number | null) => void): void;
  measurePrompt(id: string, callback: (y: number | null) => void): void;
  onMeasured(id: string, progress: number, top: number): void;
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
      ports.measureViewport((viewportY) => {
        if (owner !== generation || viewportY === null) return;
        ports.measurePrompt(id, (promptY) => {
          if (owner !== generation || sequence < completed || promptY === null) return;
          completed = sequence;
          const top = promptY - viewportY;
          ports.onMeasured(id, resolvePromptHandoffProgress(top), top);
        });
      });
    },
  };
}

/** Measure only the leading pair: an older prompt still partly visible and its incoming
 * replacement. Each slot retains independent callback ordering and cancellation fences.
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
