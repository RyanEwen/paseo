import { useWorkspaceLinkOpeningContext } from "@/workspace/browser/context";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type MutableRefObject,
  type ReactNode,
} from "react";
import React from "react";
import type { ToastApi } from "@/components/toast-host";
import type { OpenFileDisposition } from "@/workspace/file-open";
import type { InlinePathTarget } from "./parse";
import type { AssistantFileLinkContext, GetDirectorySuggestions } from "./resolver";

export interface AssistantFileLinkDaemonClient {
  getDirectorySuggestions: GetDirectorySuggestions;
}

export interface AssistantFileLinkResolverConfig {
  client?: AssistantFileLinkDaemonClient | null;
  serverId?: string;
  workspaceRoot?: string;
  onOpenWorkspaceFile?: (target: InlinePathTarget, disposition: OpenFileDisposition) => void;
  toast?: ToastApi | null;
  onOpenHttpUrl?: (url: string) => void | Promise<void>;
}

export interface AssistantFileLinkResolverProviderProps extends AssistantFileLinkResolverConfig {
  children: ReactNode;
}

export interface AssistantFileLinkResolverContextValue {
  configRef: MutableRefObject<AssistantFileLinkResolverConfig>;
  /** Latest primary-click policy, read when an asynchronous resolution finishes. */
  openHttpLinksInPaseoRef: MutableRefObject<boolean>;
  /** Reactive menu metadata; the explicit workspace browser opener stays available. */
  httpLinkDestination: "paseo" | "external";
  getDirectorySuggestions: GetDirectorySuggestions;
}

const AssistantFileLinkResolverContext =
  createContext<AssistantFileLinkResolverContextValue | null>(null);

export function AssistantFileLinkResolverProvider({
  client,
  serverId,
  workspaceRoot,
  onOpenWorkspaceFile,
  onOpenHttpUrl,
  toast,
  children,
}: AssistantFileLinkResolverProviderProps) {
  const { enabledRef: openHttpLinksInPaseoRef, defaultDestination: httpLinkDestination } =
    useWorkspaceLinkOpeningContext();

  const configRef = useRef<AssistantFileLinkResolverConfig>({
    client,
    serverId,
    workspaceRoot,
    onOpenWorkspaceFile,
    onOpenHttpUrl,
    toast,
  });
  configRef.current = {
    client,
    serverId,
    workspaceRoot,
    onOpenWorkspaceFile,
    onOpenHttpUrl,
    toast,
  };

  const getDirectorySuggestions = useCallback<GetDirectorySuggestions>(async (input) => {
    const activeClient = configRef.current.client;
    if (!activeClient) {
      return { entries: [], error: null };
    }

    const result = await activeClient.getDirectorySuggestions(input);
    return { entries: result.entries, error: result.error };
  }, []);

  const value = useMemo<AssistantFileLinkResolverContextValue>(
    () => ({
      configRef,
      getDirectorySuggestions,
      openHttpLinksInPaseoRef,
      httpLinkDestination,
    }),
    [getDirectorySuggestions, openHttpLinksInPaseoRef, httpLinkDestination],
  );

  return (
    <AssistantFileLinkResolverContext.Provider value={value}>
      {children}
    </AssistantFileLinkResolverContext.Provider>
  );
}

export function useAssistantFileLinkResolverContext(): AssistantFileLinkResolverContextValue {
  const context = useContext(AssistantFileLinkResolverContext);
  if (!context) {
    throw new Error("AssistantFileLinkResolverProvider is required for assistant file links.");
  }
  return context;
}

export type { AssistantFileLinkContext };
