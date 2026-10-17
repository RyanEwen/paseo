import Svg, { Rect } from "react-native-svg";
import { withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";

/** Divider presets describe both existing panes without selecting either one. */
function SplitLayoutGlyph({
  direction,
  fraction,
  color = "",
}: {
  direction: "horizontal" | "vertical";
  fraction: number;
  color?: string;
}) {
  const horizontal = direction === "horizontal";
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
        fill="none"
      />
      <Rect
        x={horizontal ? firstSize + 3 : 1}
        y={horizontal ? 1 : firstSize + 3}
        width={horizontal ? secondSize : 42}
        height={horizontal ? 24 : secondSize}
        rx={2}
        stroke={color}
        strokeWidth={1}
        fill="none"
      />
    </Svg>
  );
}
const mapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const ThemedGlyph = withUnistyles(SplitLayoutGlyph);

/** Show the whole adjacent pair when choosing a divider ratio. */
export function SplitPresetGlyph({
  direction,
  fraction,
}: {
  direction: "horizontal" | "vertical";
  fraction: number;
}) {
  return <ThemedGlyph direction={direction} fraction={fraction} uniProps={mapping} />;
}
