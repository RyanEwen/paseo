import { i18n } from "@/i18n/i18next";
import { useAndroidUpdate } from "./store";

/** Use the same operation feedback in Settings and the update callout. */
export function androidUpdateStatus(): string {
  const { status, update, error } = useAndroidUpdate.getState();
  if (status === "error") return error ?? i18n.t("androidUpdates.failed");
  if (status === "available" && update) {
    return i18n.t("androidUpdates.available", { version: update.version });
  }
  return i18n.t(`androidUpdates.${status}`);
}
