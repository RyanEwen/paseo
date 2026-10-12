import type { AppSettingsUpdate } from "@/hooks/use-settings/storage";
import type { QueryClient } from "@tanstack/react-query";

let handler: ((queryClient: QueryClient, updates: AppSettingsUpdate) => Promise<boolean>) | null =
  null;
let editingBlocked = false;
const listeners = new Set<() => void>();

/** Installed once by app bootstrap; return false to retain the ordinary local storage path. */
export function installSettingsSyncSaveHandler(next: typeof handler): () => void {
  handler = next;
  return () => {
    if (handler === next) {
      handler = null;
      setSettingsEditingBlocked(false);
    }
  };
}

export function getSettingsSyncSaveHandler(): typeof handler {
  return handler;
}

/** Settings controls share the same adoption gate as writes, including non-Settings callers. */
export function setSettingsEditingBlocked(value: boolean): void {
  if (editingBlocked === value) return;
  editingBlocked = value;
  for (const listener of listeners) listener();
}
export function getSettingsEditingBlocked(): boolean {
  return editingBlocked;
}
export function subscribeSettingsEditingBlocked(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

let hostSelected = false;
/** Automatic sidebar reconciliation must not prune preferences owned by another client. */
export function setSettingsHostSelected(value: boolean): void {
  hostSelected = value;
}
export function getSettingsHostSelected(): boolean {
  return hostSelected;
}
