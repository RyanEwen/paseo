import Constants from "expo-constants";
import { requireOptionalNativeModule } from "expo-modules-core";
import type { AndroidUpdaterNative } from "./native-contract";

const isPreviewBuild = Constants.expoConfig?.extra?.previewBuild === true;
export const androidUpdaterNative = isPreviewBuild
  ? requireOptionalNativeModule<AndroidUpdaterNative>("PaseoAppUpdate")
  : null;
