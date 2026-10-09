import { useEffect } from "react";
import { AppState } from "react-native";
import { useTranslation } from "react-i18next";
import { useSidebarCallouts } from "@/contexts/sidebar-callout-context";
import { androidUpdaterNative } from "./native";
import { useAndroidUpdate } from "./store";
import { androidUpdateStatus } from "./status";

const checkIntervalMs = 30 * 60 * 1000;

/** Check at startup and on resume, and offer explicit installation without interrupting work. */
export function AndroidUpdateCalloutSource() {
  const { t } = useTranslation();
  const callouts = useSidebarCallouts();
  const { status, update, error, check, install } = useAndroidUpdate();
  useEffect(() => {
    if (!androidUpdaterNative) return;
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
  }, [check]);

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
