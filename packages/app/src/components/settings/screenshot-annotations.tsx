import { StyleSheet } from "react-native";
import Svg, { G, Path, Rect } from "react-native-svg";
import { buildScreenshotArrowPath, type ScreenshotArrow } from "./screenshot-arrow";

/** Outline coordinates use pixels within the displayed screenshot viewport. */
export interface ScreenshotOutline {
  /** Match the highlighted control’s corner radius; four pixels is the default. */
  radius?: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

interface ScreenshotAnnotationsProps {
  width: number;
  height: number;
  arrows?: readonly ScreenshotArrow[];
  outlines?: readonly ScreenshotOutline[];
}

/** Decorative vector markup over an actual image; use inside its positioned picture frame. */
export function ScreenshotAnnotations({
  width,
  height,
  arrows = [],
  outlines = [],
}: ScreenshotAnnotationsProps) {
  return (
    <Svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${width} ${height}`}
      pointerEvents="none"
      accessible={false}
      aria-hidden
      style={StyleSheet.absoluteFillObject}
    >
      {outlines.map((outline) => (
        <G key={`${outline.left}:${outline.top}`} fill="none">
          <Rect
            x={outline.left}
            y={outline.top}
            width={outline.width}
            height={outline.height}
            rx={outline.radius ?? 4}
            stroke="#ffffff"
            strokeWidth={5}
          />
          <Rect
            x={outline.left}
            y={outline.top}
            width={outline.width}
            height={outline.height}
            rx={outline.radius ?? 4}
            stroke="#c62828"
            strokeWidth={2.5}
          />
        </G>
      ))}
      {arrows.map((arrow) => {
        const path = buildScreenshotArrowPath(arrow);
        // Fixed high-contrast graphic colours match the exported examples, not app state.
        return (
          <G key={path} fill="none" strokeLinecap="round" strokeLinejoin="round">
            <Path d={path} stroke="#ffffff" strokeWidth={5} />
            <Path d={path} stroke="#c62828" strokeWidth={2.5} />
          </G>
        );
      })}
    </Svg>
  );
}
