import { formatFileSize } from "@/utils/format-file-size";
import { i18n } from "@/i18n/i18next";
import { useAndroidUpdate } from "./store";

/** Use the same operation feedback in Settings and the update callout. */
export function androidUpdateStatus(): string {
  const { status, update, error, progress } = useAndroidUpdate.getState();
  if (status === "downloading" && progress) {
    const bytes = formatFileSize(progress.bytesDownloaded);
    if (progress.totalBytes && progress.totalBytes > 0) {
      const percent = Math.min(
        100,
        Math.round((progress.bytesDownloaded / progress.totalBytes) * 100),
      );
      return i18n.t("androidUpdates.downloadProgress", {
        percent,
        downloaded: bytes,
        total: formatFileSize(progress.totalBytes),
      });
    }
    return i18n.t("androidUpdates.downloadBytes", { downloaded: bytes });
  }
  if (status === "error") return error ?? i18n.t("androidUpdates.failed");
  if (status === "available" && update) {
    return i18n.t("androidUpdates.available", { version: update.version });
  }
  return i18n.t(`androidUpdates.${status}`);
}
