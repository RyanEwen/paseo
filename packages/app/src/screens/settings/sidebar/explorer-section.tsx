import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  SettingsCard,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@/components/settings";
import { isWeb } from "@/constants/platform";
import { useAppSettings, type AppSettings } from "@/hooks/use-settings";

/** Explorer defaults for new workspaces and changed-file navigation. */
export function ExplorerSection() {
  const { t } = useTranslation();
  const { settings, updateSettings } = useAppSettings();
  const changeAutoOpen = useCallback(
    (autoOpenExplorerSidebar: boolean) => void updateSettings({ autoOpenExplorerSidebar }),
    [updateSettings],
  );
  const changeDiffScope = useCallback(
    (explorerDiffScope: AppSettings["explorerDiffScope"]) =>
      void updateSettings({ explorerDiffScope }),
    [updateSettings],
  );
  const diffScopeOptions = useMemo(
    () =>
      (["all", "single"] as const).map((value) => ({
        value,
        label: t(`settings.layout.explorer.diffScope.options.${value}`),
      })),
    [t],
  );

  const changeDefaultComparison = useCallback(
    (workingDiffDefaultComparison: AppSettings["workingDiffDefaultComparison"]) =>
      void updateSettings({ workingDiffDefaultComparison }),
    [updateSettings],
  );
  const changeAutoSwitch = useCallback(
    (workingDiffAutoSwitch: boolean) => void updateSettings({ workingDiffAutoSwitch }),
    [updateSettings],
  );
  const comparisonOptions = useMemo(
    () =>
      (["uncommitted", "base"] as const).map((value) => ({
        value,
        label: t(`settings.layout.explorer.comparison.options.${value}`),
      })),
    [t],
  );

  return (
    <SettingsSection title={t("settings.layout.explorer.title")}>
      <SettingsCard>
        {isWeb ? (
          <SettingsSwitch
            label={t("settings.layout.explorer.autoOpen.label")}
            hint={t("settings.layout.explorer.autoOpen.description")}
            value={settings.autoOpenExplorerSidebar}
            onValueChange={changeAutoOpen}
          />
        ) : null}
        <SettingsSelect
          label={t("settings.layout.explorer.diffScope.label")}
          hint={t("settings.layout.explorer.diffScope.description")}
          value={settings.explorerDiffScope}
          options={diffScopeOptions}
          onValueChange={changeDiffScope}
        />
        <SettingsSelect
          label={t("settings.layout.explorer.comparison.label")}
          hint={t("settings.layout.explorer.comparison.description")}
          value={settings.workingDiffDefaultComparison}
          options={comparisonOptions}
          disabled={settings.workingDiffAutoSwitch}
          onValueChange={changeDefaultComparison}
        />
        <SettingsSwitch
          label={t("settings.layout.explorer.autoSwitch.label")}
          hint={t("settings.layout.explorer.autoSwitch.description")}
          value={settings.workingDiffAutoSwitch}
          onValueChange={changeAutoSwitch}
        />
      </SettingsCard>
    </SettingsSection>
  );
}
