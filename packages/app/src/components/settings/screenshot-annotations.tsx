import { StyleSheet } from "react-native";
import Svg, { G, Path } from "react-native-svg";
import { buildScreenshotArrowPath, type ScreenshotArrow } from "./screenshot-arrow";

interface ScreenshotAnnotationsProps {
  width: number;
  height: number;
  arrows: readonly ScreenshotArrow[];
}

/** Decorative vector markup over an actual image; use inside its positioned picture frame. */
export function ScreenshotAnnotations({ width, height, arrows }: ScreenshotAnnotationsProps) {
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
