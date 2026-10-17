/** Arrow coordinates use original cropped screenshot pixels, independent of display size. */
export interface ScreenshotArrow {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

/** Build a vector pointer used by both live help and exported annotated examples. Pixels stay unchanged. */
export function buildScreenshotArrowPath(arrow: ScreenshotArrow): string {
  const direction = Math.atan2(arrow.toY - arrow.fromY, arrow.toX - arrow.fromX);
  const headLength = 8;
  const spread = Math.PI / 6;
  const leftX = arrow.toX - headLength * Math.cos(direction - spread);
  const leftY = arrow.toY - headLength * Math.sin(direction - spread);
  const rightX = arrow.toX - headLength * Math.cos(direction + spread);
  const rightY = arrow.toY - headLength * Math.sin(direction + spread);
  return `M ${arrow.fromX} ${arrow.fromY} L ${arrow.toX} ${arrow.toY} M ${leftX} ${leftY} L ${arrow.toX} ${arrow.toY} L ${rightX} ${rightY}`;
}
