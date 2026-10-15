import { getIsElectron } from "@/constants/platform";
import { createContext, useContext, createElement, type ReactNode } from "react";
import type { OpenWorkspaceBrowserUrl } from "./use-opening";

const WorkspaceBrowserOpeningContext = createContext<OpenWorkspaceBrowserUrl | undefined>(
  undefined,
);

export const WorkspaceBrowserOpeningProvider = WorkspaceBrowserOpeningContext.Provider;

/** Resolve links against the owning workspace, including panels rendered through portals. */
export function useWorkspaceBrowserOpeningContext(): OpenWorkspaceBrowserUrl | undefined {
  return useContext(WorkspaceBrowserOpeningContext);
}

/** Keep the desktop availability boundary out of callers that already own a focused-pane opener. */
export function WorkspaceBrowserScope({
  openUrl,
  children,
}: {
  openUrl?: OpenWorkspaceBrowserUrl;
  children: ReactNode;
}) {
  const availableOpener = getIsElectron() ? openUrl : undefined;
  return createElement(WorkspaceBrowserOpeningProvider, { value: availableOpener }, children);
}
