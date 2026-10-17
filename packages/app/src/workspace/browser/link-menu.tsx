import { workspaceBrowserLinkDestinations, type BrowserLinkDestination } from "./opening";
import { useCallback, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "@/components/ui/context-menu";
import { useToast } from "@/contexts/toast-api-context";
import { isWeb } from "@/constants/platform";
import { isHttpUrl } from "@/utils/http-url";
import { useWorkspaceBrowserOpeningContext } from "./context";
import { openExternalUrl } from "@/utils/open-external-url";

/** Offer browser destinations while preserving the wrapped link's primary action. */
export function WorkspaceHttpLinkMenu({
  url,
  children,
  defaultDestination = "external",
}: {
  url: string | null | undefined;
  children: ReactNode;
  defaultDestination?: BrowserLinkDestination;
}) {
  const openInPaseo = useWorkspaceBrowserOpeningContext();
  const destinations = workspaceBrowserLinkDestinations({
    url,
    hasWorkspaceBrowser: Boolean(openInPaseo),
    defaultDestination,
  });
  if (!isWeb || !url || destinations.length === 0) {
    return children;
  }
  return (
    <BrowserLinkMenu url={url} destinations={destinations}>
      {children}
    </BrowserLinkMenu>
  );
}

function BrowserLinkMenu({
  url,
  children,
  destinations,
}: {
  url: string;
  children: ReactNode;
  destinations: BrowserLinkDestination[];
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger contextOnly style={styles.inline}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent testID="workspace-http-link-menu">
        {destinations.map((destination) => (
          <BrowserDestinationMenuItem key={destination} url={url} destination={destination} />
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** Add the same internal destination to an existing dropdown, without a nested menu. */
export function WorkspaceBrowserMenuItem({ url }: { url: string | null | undefined }) {
  const openInPaseo = useWorkspaceBrowserOpeningContext();
  if (!isWeb || !url || !isHttpUrl(url) || !openInPaseo) {
    return null;
  }
  return <BrowserDestinationMenuItem url={url} destination="paseo" />;
}

function BrowserDestinationMenuItem({
  url,
  destination,
}: {
  url: string;
  destination: BrowserLinkDestination;
}) {
  const { t } = useTranslation();
  const { open } = useBrowserLinkOpening(url);
  const { mutate, isPending } = open;
  const select = useCallback(() => mutate(destination), [mutate, destination]);
  const labelKey =
    destination === "paseo" ? "workspace.browser.openInPaseo" : "workspace.browser.openExternally";
  return (
    <ContextMenuItem onSelect={select} disabled={isPending}>
      {t(labelKey)}
    </ContextMenuItem>
  );
}

/** Keep pending and error ownership identical across link and existing-menu triggers. */
function useBrowserLinkOpening(url: string | null | undefined) {
  const toast = useToast();
  const openInPaseo = useWorkspaceBrowserOpeningContext();
  const open = useMutation({
    mutationFn: async (destination: "paseo" | "external") => {
      if (!url) {
        throw new Error("A browser destination URL is required.");
      }
      if (destination === "paseo") {
        if (!openInPaseo) {
          throw new Error("A workspace browser is unavailable.");
        }
        await openInPaseo(url);
      } else {
        await openExternalUrl(url);
      }
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : String(error)),
  });
  return { open, openInPaseo };
}

const styles = StyleSheet.create({ inline: { display: "contents" } });
