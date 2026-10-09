export interface AndroidUpdaterNative {
  getVersionCode(): number;
  download(url: string, sha256: string, versionCode: number): Promise<void>;
  install(versionCode: number): Promise<"permission_required" | "installer_opened">;
}
