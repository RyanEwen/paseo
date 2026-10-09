import { useCallback } from "react";
import { View, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { androidUpdaterNative } from "./native";
import { useAndroidUpdate } from "./store";
import { androidUpdateStatus } from "./status";

/** Fork APK controls follow the existing About update row and Android's install approval flow. */
export function AndroidAppUpdateRow() {
  const { t } = useTranslation();
  const { status, update, check, install } = useAndroidUpdate();
  const handleCheck = useCallback(() => void check(), [check]);
  const handleInstall = useCallback(() => void install(), [install]);
  if (!androidUpdaterNative) return null;
  const busy = status === "checking" || status === "downloading";
  return (
    <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{t("settings.about.updates.label")}</Text>
        <Text style={status === "error" ? settingsStyles.rowError : settingsStyles.rowHint}>
          {androidUpdateStatus()}
        </Text>
      </View>
      <View style={styles.actions}>
        <Button variant="outline" size="sm" disabled={busy} onPress={handleCheck}>
          {t("settings.about.updates.check")}
        </Button>
        {update ? (
          <Button variant="default" size="sm" disabled={busy} onPress={handleInstall}>
            {t("androidUpdates.install")}
          </Button>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  actions: { gap: theme.spacing[2], alignItems: "flex-end" },
}));
