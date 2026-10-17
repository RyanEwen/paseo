import { ScreenshotAnnotations, type ScreenshotOutline } from "./screenshot-annotations";
import type { ScreenshotArrow } from "./screenshot-arrow";
import { useMemo } from "react";
import { Image, Text, View, useWindowDimensions, type ImageRequireSource } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { SettingsInfoTip } from "./headings/settings-info-tip";

interface ScreenshotViewport {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SettingsExampleImage {
  id: string;
  /** Static require of an actual local screenshot asset. Remote image URLs are not accepted. */
  source: ImageRequireSource;
  /** Original screenshot pixel dimensions. The bundled capture stays intact. */
  width: number;
  height: number;
  /** The contextual region to display, in original screenshot pixels. */
  viewport?: ScreenshotViewport;
  label?: "before" | "after";
  /** Optional pointers are a separate vector layer, never fabricated screenshot content. */
  arrows?: readonly ScreenshotArrow[];
  /** One outline can identify a menu item or a related group of icon controls. */
  outlines?: readonly ScreenshotOutline[];
}

interface SettingsExampleProps {
  title: string;
  caption: string;
  images?: readonly SettingsExampleImage[];
  testID: string;
}

/** Use the established help trigger; absent qualified screenshots produce text help only. */
export function SettingsExample({ title, caption, images, testID }: SettingsExampleProps) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const exampleWidth = Math.min(320, width - 48);
  const content = useMemo(() => {
    if (!images || images.length === 0) return caption;
    return (
      <View style={[styles.example, { width: exampleWidth }]}>
        {images.map((image) => {
          const viewport = image.viewport ?? {
            left: 0,
            top: 0,
            width: image.width,
            height: image.height,
          };
          const displayWidth = Math.min(exampleWidth, viewport.width);
          const scale = displayWidth / viewport.width;
          const displayHeight = scale * viewport.height;
          const label = image.label ? t(`paseoPlusPlus.examples.${image.label}`) : undefined;
          return (
            <View key={image.id} style={styles.frame}>
              {label ? <Text style={styles.caption}>{label}</Text> : null}
              <View style={[styles.picture, { width: displayWidth, height: displayHeight }]}>
                <Image
                  source={image.source}
                  resizeMode="contain"
                  accessibilityLabel={`${t("paseoPlusPlus.examples.imageLabel", { title })}. ${label ?? caption}`}
                  style={[
                    styles.image,
                    {
                      width: scale * image.width,
                      height: scale * image.height,
                      left: -scale * viewport.left,
                      top: -scale * viewport.top,
                    },
                  ]}
                />
                {image.arrows?.length || image.outlines?.length ? (
                  <ScreenshotAnnotations
                    width={viewport.width}
                    height={viewport.height}
                    arrows={image.arrows}
                    outlines={image.outlines}
                  />
                ) : null}
              </View>
            </View>
          );
        })}
        <Text style={styles.caption}>
          {caption}
          {images.some((image) => image.arrows?.length)
            ? ` ${t("paseoPlusPlus.examples.annotated")}`
            : ""}
        </Text>
      </View>
    );
  }, [images, title, caption, t, exampleWidth]);

  return (
    <SettingsInfoTip
      title={title}
      info={content}
      testID={testID}
      contentTestID={`${testID}-content`}
      contentMaxWidth={exampleWidth + 18}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  example: { gap: theme.spacing[2] },
  frame: { gap: theme.spacing[1] },
  picture: {
    alignSelf: "flex-start",
    position: "relative",
    overflow: "hidden",
    borderRadius: theme.borderRadius.sm,
  },
  image: { position: "absolute" },
  caption: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: theme.fontSize.base * 1.4,
  },
}));
