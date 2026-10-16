import { useToast } from "@/contexts/toast-api-context";
import { getIsElectron } from "@/constants/platform";
import {
  createContext,
  useContext,
  createElement,
  useRef,
  useMemo,
  useCallback,
  type ReactNode,
} from "react";
import { useAppSettings } from "@/hooks/use-settings";
import { openExternalUrl } from "@/utils/open-external-url";
import { openWorkspaceLink, type BrowserLinkDestination } from "./opening";
import type { OpenWorkspaceBrowserUrl } from "./use-opening";

interface WorkspaceLinkOpeningContextValue {
  openInPaseo: OpenWorkspaceBrowserUrl | undefined;
  openPrimary: (url: string) => Promise<void>;
  reportError?: (error: unknown) => void;
  enabledRef: { current: boolean };
  defaultDestination: BrowserLinkDestination;
}

const EXTERNAL_LINK_CONTEXT: WorkspaceLinkOpeningContextValue = {
  openInPaseo: undefined,
  openPrimary: openExternalUrl,
  enabledRef: { current: false },
  defaultDestination: "external",
};
const WorkspaceLinkOpeningContext = createContext(EXTERNAL_LINK_CONTEXT);

/** Subscribe once per owning workspace scope; link callbacks read the current choice when activated. */
export function WorkspaceBrowserOpeningProvider({
  value,
  children,
}: {
  value: OpenWorkspaceBrowserUrl | undefined;
  children?: ReactNode;
}) {
  const { settings } = useAppSettings();
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const reportError = useCallback((error: unknown) => {
    toastRef.current.error(error instanceof Error ? error.message : String(error));
  }, []);
  const enabled = settings.paseoPlusPlus.workspaceChatLinks;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const openPrimary = useCallback(
    (url: string) =>
      openWorkspaceLink(url, {
        isEnabled: () => enabledRef.current,
        openInPaseo: value,
        openExternally: openExternalUrl,
      }).catch(reportError),
    [value, reportError],
  );
  const context = useMemo<WorkspaceLinkOpeningContextValue>(
    () => ({
      openInPaseo: value,
      openPrimary,
      reportError,
      enabledRef,
      defaultDestination: enabled && value ? "paseo" : "external",
    }),
    [value, openPrimary, reportError, enabled],
  );
  return createElement(WorkspaceLinkOpeningContext.Provider, { value: context }, children);
}

/** Explicit destinations ignore the primary-click preference. */
export function useWorkspaceBrowserOpeningContext(): OpenWorkspaceBrowserUrl | undefined {
  return useContext(WorkspaceLinkOpeningContext).openInPaseo;
}

/** Primary activation always belongs to this provider's workspace, never the globally selected one. */
export function useWorkspaceLinkOpeningContext(): WorkspaceLinkOpeningContextValue {
  return useContext(WorkspaceLinkOpeningContext);
}

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
