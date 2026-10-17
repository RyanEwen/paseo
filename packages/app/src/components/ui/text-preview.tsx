import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { isWeb } from "@/constants/platform";
import { memo, useEffect, useMemo, type KeyboardEvent } from "react";
import { Text, View, type TextProps } from "react-native";
import { useTextOverflow } from "@/hooks/use-text-overflow";

/** A clamped Text with an inaccessible, identically styled full-layout probe. The probe
 * takes no layout space and reports real wrapping, including font and width changes.
 */
export const TextPreview = memo(function TextPreview({
  children,
  numberOfLines,
  onOverflowChange,
  onKeyDown,
  tabIndex,
  ...props
}: TextProps & {
  children: string;
  numberOfLines: number;
  onOverflowChange: (overflowing: boolean) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  tabIndex?: number;
}) {
  // RN web's one-line shortcut flattens newlines. Use its multiline CSS clamp even
  // for one line so the copied prefix has the same wrapping as the original Text.
  const clampedStyle = useMemo(
    () => [
      props.style,
      isWeb
        ? inlineUnistylesStyle({
            overflow: "hidden" as const,
            WebkitLineClamp: numberOfLines,
            whiteSpace: "pre-wrap",
            wordWrap: "break-word",
          })
        : undefined,
    ],
    [props.style, numberOfLines],
  );
  const overflow = useTextOverflow(children, numberOfLines);
  useEffect(
    () => onOverflowChange(overflow.overflowing),
    [children, numberOfLines, onOverflowChange, overflow.overflowing],
  );
  return (
    <View style={styles.container}>
      <Text
        {...props}
        {...{ onKeyDown, tabIndex }}
        style={clampedStyle}
        numberOfLines={isWeb ? Math.max(2, numberOfLines) : numberOfLines}
        ref={overflow.ref}
        onLayout={overflow.onLayout}
      >
        {children}
      </Text>
      <View
        style={styles.measurement}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        aria-hidden
      >
        <Text
          {...props}
          selectable={false}
          dataSet={undefined}
          onLayout={overflow.onFullLayout}
          onPress={undefined}
          onLongPress={undefined}
          style={props.style}
          accessible={false}
          accessibilityRole={undefined}
          accessibilityLabel={undefined}
          accessibilityHint={undefined}
          ref={overflow.fullRef}
          onTextLayout={overflow.onFullTextLayout}
          testID="text-preview-measurement"
        >
          {children}
        </Text>
      </View>
    </View>
  );
});

const styles = {
  container: { minWidth: 0, flexShrink: 1 },
  measurement: { position: "absolute" as const, top: 0, left: 0, right: 0, opacity: 0 },
};
