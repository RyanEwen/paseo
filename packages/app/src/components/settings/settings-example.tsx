import { ScreenshotAnnotations } from "./screenshot-annotations";
import type { ScreenshotArrow } from "./screenshot-arrow";
import { useMemo } from "react";
import { Image, Text, View, type ImageRequireSource } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { SettingsInfoTip } from "./headings/settings-info-tip";

export interface SettingsExampleImage {
  id: string;
  /** Static require of an actual local screenshot asset. Remote image URLs are not accepted. */
  source: ImageRequireSource;
  /** Actual cropped pixel dimensions, without resizing or compositing the source capture. */
  width: number;
  height: number;
  label?: "before" | "after";
  /** Optional pointers are a separate vector layer, never fabricated screenshot content. */
  arrows?: readonly ScreenshotArrow[];
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
  const content = useMemo(() => {
    if (!images || images.length === 0) return caption;
    return (
      <View style={styles.example}>
        {images.map((image) => {
          const displayWidth = Math.min(256, image.width);
          const displayHeight = (displayWidth * image.height) / image.width;
          const label = image.label ? t(`paseoPlusPlus.examples.${image.label}`) : undefined;
          return (
            <View key={image.id} style={styles.frame}>
              {label ? <Text style={styles.caption}>{label}</Text> : null}
              <View style={styles.picture}>
                <Image
                  source={image.source}
                  resizeMode="contain"
                  accessibilityLabel={`${t("paseoPlusPlus.examples.imageLabel", { title })}. ${label ?? caption}`}
                  style={[styles.image, { width: displayWidth, height: displayHeight }]}
                />
                {image.arrows?.length ? (
                  <ScreenshotAnnotations
                    width={image.width}
                    height={image.height}
                    arrows={image.arrows}
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
  }, [images, title, caption, t]);

  return (
    <SettingsInfoTip
      title={title}
      info={content}
      testID={testID}
      contentTestID={`${testID}-content`}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  example: { width: 256, gap: theme.spacing[2] },
  frame: { gap: theme.spacing[1] },
  picture: { alignSelf: "flex-start", position: "relative" },
  image: { alignSelf: "flex-start", borderRadius: theme.borderRadius.sm },
  caption: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: theme.fontSize.base * 1.4,
  },
}));
