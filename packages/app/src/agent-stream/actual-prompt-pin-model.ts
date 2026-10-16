interface MeasuredPromptRow {
  id: string;
  top: number;
  height: number;
}

export interface ActualPromptPin {
  id: string;
  translateY: number;
}

/** Use original row geometry, never a previously translated bubble measurement.
 * Rows arrive in chronological layout order. Only one actual row is retained;
 * the next user row pushes it away at their shared edge without overlapping ink.
 */
export function resolveActualPromptPin(
  rows: readonly MeasuredPromptRow[],
  viewportTop: number,
): ActualPromptPin | null {
  let active: MeasuredPromptRow | undefined;
  let next: MeasuredPromptRow | undefined;
  for (const row of rows) {
    if (row.top <= viewportTop) active = row;
    else {
      next = row;
      break;
    }
  }
  if (!active) return null;
  const translateY = Math.max(0, viewportTop - active.top);
  const collisionLimit = next ? next.top - active.top - active.height : translateY;
  return { id: active.id, translateY: Math.min(translateY, collisionLimit) };
}
