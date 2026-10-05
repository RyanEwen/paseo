import React, { useCallback, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetchQuery } from "@/data/query";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { getDesktopHost, type DesktopBrowserExtension } from "@/desktop/host";
import { settingsStyles } from "@/styles/settings";
import { confirmDialog } from "@/utils/confirm-dialog";

type ExtensionAction =
  | { kind: "store" | "unpacked" }
  | { kind: "enable"; id: string; enabled: boolean }
  | { kind: "remove"; id: string; name: string };

/** Browser settings manage the desktop-owned profile, independent of the selected daemon. */
export function BrowserExtensionsSection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const bridge = getDesktopHost()?.browser?.extensions;
  const queryKey = ["desktop", "browser", "extensions"];
  const extensions = useFetchQuery({
    queryKey,
    dataShape: "list",
    staleTimeMs: 1000,
    queryFn: async () => {
      if (!bridge) {
        throw new Error(t("settings.general.browserExtensions.unavailable"));
      }
      return bridge.list();
    },
    // Installs happen in a separate Store window. Keep the visible settings list current.
    refetchInterval: 2000,
  });
  const action = useMutation({
    mutationFn: async (input: ExtensionAction) => {
      if (!bridge) {
        throw new Error(t("settings.general.browserExtensions.unavailable"));
      }
      switch (input.kind) {
        case "store":
          return bridge.openStore();
        case "unpacked":
          return bridge.loadUnpacked();
        case "enable":
          return bridge.setEnabled(input.id, input.enabled);
        case "remove": {
          const confirmed = await confirmDialog({
            title: t("settings.general.browserExtensions.removeTitle", { name: input.name }),
            message: t("settings.general.browserExtensions.removeMessage"),
            confirmLabel: t("settings.general.browserExtensions.remove"),
            cancelLabel: t("common.actions.cancel"),
            destructive: true,
          });
          if (confirmed) {
            await bridge.remove(input.id);
          }
          return;
        }
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
    },
  });
  const busy = action.isPending;
  const { mutate } = action;
  const { refetch } = extensions;
  const refresh = useCallback(() => {
    void refetch();
  }, [refetch]);
  const openStore = useCallback(() => mutate({ kind: "store" }), [mutate]);
  const loadUnpacked = useCallback(() => mutate({ kind: "unpacked" }), [mutate]);
  const trailing = useMemo(
    () => (
      <Button variant="ghost" size="sm" disabled={extensions.isFetching} onPress={refresh}>
        {t("settings.general.browserExtensions.refresh")}
      </Button>
    ),
    [extensions.isFetching, refresh, t],
  );
  let unpackedHint = "settings.general.browserExtensions.empty";
  if (extensions.isPending) {
    unpackedHint = "settings.general.browserExtensions.loading";
  } else if (extensions.data?.length) {
    unpackedHint = "settings.general.browserExtensions.unpackedHint";
  }

  return (
    <SettingsSection
      title={t("settings.general.browserExtensions.title")}
      testID="browser-extensions"
      trailing={trailing}
    >
      {extensions.error || action.error ? (
        <Alert variant="error" description={(action.error ?? extensions.error)?.message} />
      ) : null}
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>
              {t("settings.general.browserExtensions.store")}
            </Text>
            <Text style={settingsStyles.rowHint}>
              {t("settings.general.browserExtensions.compatibility")}
            </Text>
          </View>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !bridge}
            loading={busy && action.variables?.kind === "store"}
            onPress={openStore}
          >
            {t("settings.general.browserExtensions.openStore")}
          </Button>
        </View>
        {(extensions.data ?? []).map((extension) => (
          <ExtensionRow
            key={extension.id}
            extension={extension}
            busy={busy}
            pending={action.isPending ? action.variables : undefined}
            dispatch={mutate}
          />
        ))}
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowHint}>{t(unpackedHint)}</Text>
          </View>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !bridge}
            loading={busy && action.variables?.kind === "unpacked"}
            onPress={loadUnpacked}
          >
            {t("settings.general.browserExtensions.loadUnpacked")}
          </Button>
        </View>
      </View>
    </SettingsSection>
  );
}

interface ExtensionRowProps {
  extension: DesktopBrowserExtension;
  busy: boolean;
  pending: ExtensionAction | undefined;
  dispatch(action: ExtensionAction): void;
}

/** Keep each installed extension on the same settings row and expose its retry state. */
function ExtensionRow({ extension, busy, pending, dispatch }: ExtensionRowProps) {
  const { t } = useTranslation();
  const toggle = useCallback(
    () =>
      dispatch({
        kind: "enable",
        id: extension.id,
        enabled: !extension.enabled || Boolean(extension.error),
      }),
    [dispatch, extension.id, extension.enabled, extension.error],
  );
  const remove = useCallback(
    () => dispatch({ kind: "remove", id: extension.id, name: extension.name }),
    [dispatch, extension.id, extension.name],
  );
  let toggleLabel = "settings.general.browserExtensions.enable";
  if (extension.error) {
    toggleLabel = "settings.general.browserExtensions.retry";
  } else if (extension.enabled) {
    toggleLabel = "settings.general.browserExtensions.disable";
  }
  return (
    <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{extension.name}</Text>
        <Text style={settingsStyles.rowHint}>{extension.version}</Text>
        {extension.error ? <Text style={settingsStyles.rowError}>{extension.error}</Text> : null}
      </View>
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        loading={pending?.kind === "enable" && pending.id === extension.id}
        onPress={toggle}
      >
        {t(toggleLabel)}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        loading={pending?.kind === "remove" && pending.id === extension.id}
        onPress={remove}
      >
        {t("settings.general.browserExtensions.remove")}
      </Button>
    </View>
  );
}
