import Svg, { Path } from "react-native-svg";
import type { SvgPathIconProps } from "./svg-path-icon";

/** Upright puzzle outline matching the browser toolbar reference, with the adjacent icons' stroke. */
export function BrowserExtensionsIcon({ size = 16, color = "currentColor" }: SvgPathIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M8 5h2V4a2.5 2.5 0 0 1 5 0v1h4a1 1 0 0 1 1 1v4h-1a2.5 2.5 0 0 0 0 5h1v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-4H4a2.5 2.5 0 0 1 0-5h1V6a1 1 0 0 1 1-1h2Z"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
