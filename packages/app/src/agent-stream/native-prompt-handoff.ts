import { resolvePromptHandoffProgress } from "./prompt-handoff";

/** Sample public native window coordinates. Changing targets invalidates old callbacks;
 * samples for the same target may finish out of order without starving during scrolling.
 */
export function createNativePromptHandoffSampler(ports: {
  measureViewport(callback: (y: number | null) => void): void;
  measurePrompt(id: string, callback: (y: number | null) => void): void;
  onMeasured(id: string, progress: number): void;
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
          ports.onMeasured(id, resolvePromptHandoffProgress(promptY - viewportY));
        });
      });
    },
  };
}
