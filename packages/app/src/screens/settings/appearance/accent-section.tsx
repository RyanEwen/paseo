import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { SettingsCard, SettingsSection, SettingsSelect } from "@/components/settings";
import { useSettingsSave } from "@/hooks/use-settings/use-settings-save";
import { useSettingsSyncState } from "@/settings-sync/bootstrap";
import { useSessionStore } from "@/stores/session-store";
import { selectAccentColorSupport } from "@/appearance/accent-support";
import { ACCENT_OPTIONS, type AccentColor } from "@/styles/accent";
import { AccentPreview } from "./accent-preview";

/** Share the standard settings save, sync, error and selected-option behavior on every platform. */
export function AccentSection() {
  const { t } = useTranslation();
  const { selectedHost } = useSettingsSyncState();
  const supported = useSessionStore((state) => selectAccentColorSupport(state, selectedHost));
  const { settings, save, pending, failed, isLoading, error } = useSettingsSave<"accentColor">();
  const options = useMemo(
    () =>
      ACCENT_OPTIONS.map((value) => ({
        value,
        label: t(`settings.appearance.accent.options.${value}`),
      })),
    [t],
  );
  const select = useCallback(
    (accentColor: AccentColor) => {
      void save("accentColor", { accentColor });
    },
    [save],
  );
  const disabled = !supported || isLoading || error !== null || pending !== null;
  let hint = t("settings.appearance.accent.hint");
  if (!supported) hint = t("settings.appearance.accent.updateHost");
  if (pending !== null) hint = t("paseoPlusPlus.saving");
  let failure: string | undefined;
  if (error) failure = t("paseoPlusPlus.loadFailed");
  if (failed) failure = t("paseoPlusPlus.saveFailed");

  return (
    <SettingsSection title={t("settings.appearance.accent.title")}>
      <SettingsCard testID="accent-color-settings">
        <SettingsSelect
          label={t("settings.appearance.accent.title")}
          hint={hint}
          error={failure}
          value={settings.accentColor}
          options={options}
          onValueChange={select}
          disabled={disabled}
        />
        <AccentPreview message={t("settings.appearance.accent.preview")} />
      </SettingsCard>
    </SettingsSection>
  );
}
