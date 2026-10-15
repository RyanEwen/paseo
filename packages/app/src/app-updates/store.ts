import type { AndroidUpdateDownloadProgress } from "./native-contract";
import { create } from "zustand";
import { androidUpdaterNative } from "./native";
import {
  findAndroidUpdate,
  readApkChecksum,
  requestUpdateResource,
  type AndroidUpdate,
} from "./releases";

interface UpdateState {
  status:
    | "idle"
    | "checking"
    | "current"
    | "available"
    | "downloading"
    | "verifying"
    | "permission"
    | "installer"
    | "error";
  update: AndroidUpdate | null;
  error: string | null;
  progress: AndroidUpdateDownloadProgress | null;
  check: (automatic?: boolean) => Promise<void>;
  install: () => Promise<void>;
}

let preparedVersionCode: number | null = null;

/** Share one operation across Settings and the sidebar; never overlap checks and downloads. */
export const useAndroidUpdate = create<UpdateState>((set, get) => ({
  status: "idle",
  update: null,
  error: null,
  progress: null,
  async check(automatic = false) {
    const native = androidUpdaterNative;
    const previous = get();
    if (!native || ["checking", "downloading", "verifying"].includes(previous.status)) return;
    // Automatic checks preserve a pending permission/install action and visible retry errors.
    if (automatic && ["permission", "installer", "error"].includes(previous.status)) return;
    set({ status: "checking", error: null, progress: null });
    try {
      const update = await findAndroidUpdate(native.getVersionCode());
      set({ update, status: update ? "available" : "current" });
    } catch (error) {
      if (automatic) {
        set({ status: previous.status });
      } else {
        set({
          status: "error",
          error: error instanceof Error ? error.message : "Unable to check for updates",
        });
      }
    }
  },
  async install() {
    const native = androidUpdaterNative;
    const { update, status } = get();
    if (!native || !update || ["checking", "downloading", "verifying"].includes(status)) return;
    set({ status: "downloading", error: null, progress: null });
    try {
      if (preparedVersionCode !== update.versionCode) {
        const response = await requestUpdateResource(update.checksumUrl);
        const sha256 = readApkChecksum(response, update.filename);
        // Scope native events to this download and remove the listener on every terminal path.
        let acceptingProgress = true;
        const subscription = native.addListener("downloadProgress", (progress) => {
          if (!acceptingProgress || progress.versionCode !== update.versionCode) return;
          set({ status: progress.phase, progress });
        });
        try {
          await native.download(update.url, sha256, update.versionCode);
        } finally {
          acceptingProgress = false;
          subscription.remove();
        }
        preparedVersionCode = update.versionCode;
      }
      const result = await native.install(update.versionCode);
      set({
        status: result === "permission_required" ? "permission" : "installer",
        progress: null,
      });
    } catch (error) {
      preparedVersionCode = null;
      set({
        status: "error",
        progress: null,
        error: error instanceof Error ? error.message : "Unable to install update",
      });
    }
  },
}));
