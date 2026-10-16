import Svg, { Rect } from "react-native-svg";
import { withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import type { SplitSide } from "./split-layout-presets";

/** The filled region marks the new pane; proportions read left-to-right or top-to-bottom. */
function SplitLayoutGlyph({
  side,
  fraction,
  color = "",
  fill = "",
}: {
  side: SplitSide;
  fraction: number;
  color?: string;
  fill?: string;
}) {
  const horizontal = side === "left" || side === "right";
  const first = side === "left" || side === "top";
  const span = horizontal ? 42 : 24;
  const firstSize = (span - 2) * fraction;
  const secondSize = span - 2 - firstSize;
  return (
    <Svg width={44} height={26} viewBox="0 0 44 26" accessible={false}>
      <Rect
        x={1}
        y={1}
        width={horizontal ? firstSize : 42}
        height={horizontal ? 24 : firstSize}
        rx={2}
        stroke={color}
        strokeWidth={1}
        fill={first ? fill : "none"}
        fillOpacity={0.3}
      />
      <Rect
        x={horizontal ? firstSize + 3 : 1}
        y={horizontal ? 1 : firstSize + 3}
        width={horizontal ? secondSize : 42}
        height={horizontal ? 24 : secondSize}
        rx={2}
        stroke={color}
        strokeWidth={1}
        fill={first ? "none" : fill}
        fillOpacity={0.3}
      />
    </Svg>
  );
}
const mapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  fill: theme.colors.foregroundMuted,
});
const ThemedGlyph = withUnistyles(SplitLayoutGlyph);

/** Use the same diagram in launcher choices, tab menus, and divider presets. */
export function SplitPresetGlyph({ side, fraction }: { side: SplitSide; fraction: number }) {
  return <ThemedGlyph side={side} fraction={fraction} uniProps={mapping} />;
}
