/** Native onTextLayout describes the one natural Text. Stop before the next
 * line's actual top when font metrics overlap; otherwise its ink can peek out. */
export function nativeTextPreviewMetrics(
  lines: readonly { y: number; height: number }[],
  visibleLines: number,
) {
  const count = lines.length;
  const lastIndex = Math.min(count, Math.max(1, visibleLines)) - 1;
  const last = lines[lastIndex];
  const next = lines[lastIndex + 1];
  return {
    count,
    height: last ? Math.max(0, Math.min(last.y + last.height, next?.y ?? Infinity)) : 0,
  };
}
