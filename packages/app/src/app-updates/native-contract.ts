import type { EventSubscription } from "expo-modules-core";

export interface AndroidUpdateDownloadProgress {
  versionCode: number;
  phase: "downloading" | "verifying";
  bytesDownloaded: number;
  totalBytes: number | null;
}

export interface AndroidUpdaterNative {
  getVersionCode(): number;
  addListener(
    name: "downloadProgress",
    handler: (progress: AndroidUpdateDownloadProgress) => void,
  ): EventSubscription;
  download(url: string, sha256: string, versionCode: number): Promise<void>;
  install(versionCode: number): Promise<"permission_required" | "installer_opened">;
}
