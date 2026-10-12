import { useEffect } from "react";
import { AppState } from "react-native";
import { useTranslation } from "react-i18next";
import { useAppSettings } from "@/hooks/use-settings";
import { useSidebarCallouts } from "@/contexts/sidebar-callout-context";
import { androidUpdaterNative } from "./native";
import { useAndroidUpdate } from "./store";
import { androidUpdateStatus } from "./status";

const checkIntervalMs = 30 * 60 * 1000;

/** Check at startup and on resume, and offer explicit installation without interrupting work. */
export function AndroidUpdateCalloutSource() {
  const { t } = useTranslation();
  const callouts = useSidebarCallouts();
  const { settings, isLoading, error: settingsError } = useAppSettings();
  const automaticChecksAllowed =
    !isLoading && settingsError === null && settings.paseoPlusPlus.androidAutomaticUpdateChecks;
  const { status, update, error, check, install } = useAndroidUpdate();
  useEffect(() => {
    // Wait for persisted opt-outs before scheduling any automatic network request.
    if (!androidUpdaterNative || !automaticChecksAllowed) return;
    void check(true);
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void check(true);
    }, checkIntervalMs);
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void check(true);
    });
    return () => {
      clearInterval(timer);
      listener.remove();
    };
  }, [check, automaticChecksAllowed]);

  useEffect(() => {
    if (!androidUpdaterNative || (!update && !error) || status === "checking") return;
    const busy = status === "downloading";
    return callouts.show({
      id: "android-app-update",
      dismissalKey: `android-app-update:${update?.version ?? "error"}:${status}`,
      priority: 200,
      title: t("androidUpdates.title"),
      description: androidUpdateStatus(),
      variant: status === "error" ? "error" : "default",
      actions: [
        {
          label: update ? t("androidUpdates.install") : t("common.actions.retry"),
          onPress: () => {
            if (update) void install();
            else void check();
          },
          variant: "primary",
          disabled: busy,
        },
      ],
      testID: "android-update-callout",
    });
  }, [callouts, status, update, error, check, install, t]);
  return null;
}
