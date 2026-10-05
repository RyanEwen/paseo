import { useCallback, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Text,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { BrowserExtensionsIcon } from "@/components/icons/browser-extensions-icon";
import { withUnistyles } from "react-native-unistyles";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useFetchQuery } from "@/data/query";
import { getDesktopHost, type DesktopBrowserExtensionAction } from "@/desktop/host";
import { Alert } from "@/components/ui/alert";
import { buildSettingsSectionRoute } from "@/utils/host-routes";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const ThemedPuzzle = withUnistyles(BrowserExtensionsIcon);
const mutedIcon = (theme: { colors: { foregroundMuted: string } }) => ({
  color: theme.colors.foregroundMuted,
});

interface ExtensionsMenuProps {
  browserId: string;
  triggerStyle(state: { hovered?: boolean; pressed?: boolean }): StyleProp<ViewStyle>;
  tooltipTextStyle: StyleProp<TextStyle>;
}

/** Expose actual extension popups alongside installation and management in browser chrome. */
export function ExtensionsMenu({ browserId, triggerStyle, tooltipTextStyle }: ExtensionsMenuProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const bridge = getDesktopHost()?.browser?.extensions;
  const actions = useFetchQuery({
    queryKey: ["desktop", "browser", "extension-actions"],
    dataShape: "list",
    staleTimeMs: 0,
    enabled: open && Boolean(bridge),
    queryFn: async () => {
      if (!bridge) {
        throw new Error(t("settings.general.browserExtensions.unavailable"));
      }
      return bridge.actions();
    },
  });
  const action = useMutation({
    mutationFn: async (id: string | null) => {
      if (!bridge) {
        throw new Error(t("settings.general.browserExtensions.unavailable"));
      }
      if (id === null) {
        await bridge.openStore();
      } else {
        await bridge.openPopup(id, browserId);
      }
    },
    onError: () => setOpen(true),
  });
  const label = t("workspace.browser.extensions.label");
  const { mutate } = action;
  const openStore = useCallback(() => mutate(null), [mutate]);
  const manage = useCallback(() => router.push(buildSettingsSectionRoute("browser")), [router]);
  let status: ReactNode = null;
  if (actions.error) {
    status = <DropdownMenuItem disabled>{actions.error.message}</DropdownMenuItem>;
  } else if (actions.isPending) {
    status = (
      <DropdownMenuItem disabled>{t("workspace.browser.extensions.loading")}</DropdownMenuItem>
    );
  } else if (actions.data.length === 0) {
    status = (
      <DropdownMenuItem disabled>{t("workspace.browser.extensions.empty")}</DropdownMenuItem>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger
            accessibilityRole="button"
            accessibilityLabel={label}
            style={triggerStyle}
          >
            {action.isPending ? (
              <ActivityIndicator size="small" />
            ) : (
              <ThemedPuzzle size={16} uniProps={mutedIcon} />
            )}
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="center" offset={8}>
          <Text style={tooltipTextStyle}>{label}</Text>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" width={300} scrollable maxHeight={360}>
        {action.error ? (
          <Alert
            variant="error"
            size="sm"
            title={t("workspace.browser.extensions.openFailed")}
            description={action.error.message}
          />
        ) : null}
        {status}
        {(actions.data ?? []).map((extension) => (
          <ExtensionMenuItem
            key={extension.id}
            extension={extension}
            busy={action.isPending}
            noPopupLabel={t("workspace.browser.extensions.noPopup")}
            openPopup={mutate}
          />
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={action.isPending} onSelect={openStore}>
          {t("settings.general.browserExtensions.openStore")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={manage}>
          {t("workspace.browser.extensions.manage")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface ExtensionMenuItemProps {
  extension: DesktopBrowserExtensionAction;
  busy: boolean;
  noPopupLabel: string;
  openPopup(id: string): void;
}

function ExtensionMenuItem({ extension, busy, noPopupLabel, openPopup }: ExtensionMenuItemProps) {
  const select = useCallback(() => openPopup(extension.id), [extension.id, openPopup]);
  return (
    <DropdownMenuItem
      disabled={!extension.hasPopup || busy}
      description={extension.hasPopup ? undefined : noPopupLabel}
      onSelect={select}
    >
      {extension.name}
    </DropdownMenuItem>
  );
}
