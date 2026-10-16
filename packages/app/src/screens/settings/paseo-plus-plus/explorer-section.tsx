import { PREFERENCE_EXAMPLE_IMAGES } from "@/paseo-plus-plus/settings-examples";
import { SettingsExample } from "@/components/settings/settings-example";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  SettingsCard,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@/components/settings";
import { isWeb } from "@/constants/platform";
import type { AppSettings } from "@/hooks/use-settings";
import { useSettingsSave } from "@/hooks/use-settings/use-settings-save";

type ExplorerSetting =
  | "autoOpenExplorerSidebar"
  | "explorerDiffScope"
  | "workingDiffDefaultComparison"
  | "workingDiffAutoSwitch";

const HELP_CONTENT = {
  autoOpenExplorerSidebar: {
    label: "settings.layout.explorer.autoOpen.label",
    hint: "settings.layout.explorer.autoOpen.description",
  },
  explorerDiffScope: {
    label: "settings.layout.explorer.diffScope.label",
    hint: "settings.layout.explorer.diffScope.description",
  },
  workingDiffDefaultComparison: {
    label: "settings.layout.explorer.comparison.label",
    hint: "settings.layout.explorer.comparison.description",
  },
  workingDiffAutoSwitch: {
    label: "settings.layout.explorer.autoSwitch.label",
    hint: "settings.layout.explorer.autoSwitch.description",
  },
} as const;

/** Explorer defaults for new workspaces and changed-file navigation. */
export function ExplorerSection() {
  const { t } = useTranslation();
  const { settings, save, pending, failed, isLoading, error } = useSettingsSave<ExplorerSetting>();
  const disabled = isLoading || error !== null || pending !== null;
  const help = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(HELP_CONTENT).map(([key, content]) => [
          key,
          <SettingsExample
            key={key}
            title={t(content.label)}
            caption={`${t(content.hint)} ${t("paseoPlusPlus.examples.explorer")}`}
            images={PREFERENCE_EXAMPLE_IMAGES.explorer}
            testID={`settings-example-${key}`}
          />,
        ]),
      ),
    [t],
  );

  /** Keep each control's attempted value outside durable settings until its save succeeds. */
  const saveSetting = useCallback(
    async <Key extends ExplorerSetting>(key: Key, value: AppSettings[Key]) => {
      const updates: Partial<AppSettings> = {};
      updates[key] = value;
      await save(key, updates);
    },
    [save],
  );

  /** Use the same in-place save feedback for switches and selects. */
  function feedback(key: ExplorerSetting, hint: string) {
    return {
      disabled,
      hint: pending === key ? t("paseoPlusPlus.saving") : hint,
      error: failed === key ? t("paseoPlusPlus.saveFailed") : undefined,
    };
  }

  const changeAutoOpen = useCallback(
    (value: boolean) => void saveSetting("autoOpenExplorerSidebar", value),
    [saveSetting],
  );
  const changeDiffScope = useCallback(
    (value: AppSettings["explorerDiffScope"]) => void saveSetting("explorerDiffScope", value),
    [saveSetting],
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
    (value: AppSettings["workingDiffDefaultComparison"]) =>
      void saveSetting("workingDiffDefaultComparison", value),
    [saveSetting],
  );
  const changeAutoSwitch = useCallback(
    (value: boolean) => void saveSetting("workingDiffAutoSwitch", value),
    [saveSetting],
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
            labelAccessory={help.autoOpenExplorerSidebar}
            {...feedback(
              "autoOpenExplorerSidebar",
              t("settings.layout.explorer.autoOpen.description"),
            )}
            value={settings.autoOpenExplorerSidebar}
            onValueChange={changeAutoOpen}
          />
        ) : null}
        <SettingsSelect
          label={t("settings.layout.explorer.diffScope.label")}
          labelAccessory={help.explorerDiffScope}
          {...feedback("explorerDiffScope", t("settings.layout.explorer.diffScope.description"))}
          value={settings.explorerDiffScope}
          options={diffScopeOptions}
          onValueChange={changeDiffScope}
        />
        <SettingsSelect
          label={t("settings.layout.explorer.comparison.label")}
          labelAccessory={help.workingDiffDefaultComparison}
          {...feedback(
            "workingDiffDefaultComparison",
            t("settings.layout.explorer.comparison.description"),
          )}
          value={settings.workingDiffDefaultComparison}
          options={comparisonOptions}
          disabled={disabled || settings.workingDiffAutoSwitch}
          onValueChange={changeDefaultComparison}
        />
        <SettingsSwitch
          label={t("settings.layout.explorer.autoSwitch.label")}
          labelAccessory={help.workingDiffAutoSwitch}
          {...feedback(
            "workingDiffAutoSwitch",
            t("settings.layout.explorer.autoSwitch.description"),
          )}
          value={settings.workingDiffAutoSwitch}
          onValueChange={changeAutoSwitch}
        />
      </SettingsCard>
    </SettingsSection>
  );
}
