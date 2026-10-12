import { ExplorerSection } from "@/screens/settings/paseo-plus-plus/explorer-section";
import { useQueryClient } from "@tanstack/react-query";
import { APP_SETTINGS_QUERY_KEY } from "@/hooks/use-settings/storage";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useCallback } from "react";
import { Platform, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import {
  SettingsAction,
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
} from "@/components/settings";
import { useSettingsSave } from "@/hooks/use-settings/use-settings-save";
import { getIsElectron } from "@/constants/platform";
import { androidUpdaterNative } from "@/app-updates/native";
import { buildSettingsSectionRoute } from "@/utils/host-routes";
import type { PaseoPlusPlusFeature } from "@/paseo-plus-plus/preferences";

const OPTIONAL_FEATURES: readonly PaseoPlusPlusFeature[] = [
  "stickyUserPrompts",
  "previousAgents",
  "sidebarProjectSelector",
  "sidebarActivityChips",
  "sidebarProjectEmphasis",
  "sidebarBulkActions",
  "projectPinning",
  "sidebarWorkspaceTransitions",
  "androidAutomaticUpdateChecks",
];

const ADDITIONS = ["ssh", "worktrees", "video"] as const;

const FIXES = [
  "forkLinks",
  "backgroundBrowser",
  "notifications",
  "reading",
  "mobile",
  "pickers",
  "identity",
] as const;

/** The fork inventory uses existing controls and device-local opt-outs without resetting data. */
export function PaseoPlusPlusSection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const retryLoad = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: APP_SETTINGS_QUERY_KEY });
  }, [queryClient]);
  const {
    settings,
    save,
    pending,
    failed,
    isLoading,
    error: settingsError,
  } = useSettingsSave<PaseoPlusPlusFeature>();

  /** Serialize preference writes so rapid toggles retain every other feature choice. */
  const changeFeature = useCallback(
    async (feature: PaseoPlusPlusFeature, enabled: boolean) => {
      await save(feature, (current) => ({
        paseoPlusPlus: { ...current.paseoPlusPlus, [feature]: enabled },
      }));
    },
    [save],
  );

  return (
    <View testID="paseo-plus-plus-settings">
      <SettingsSection title={t("paseoPlusPlus.optional")} info={t("paseoPlusPlus.optionalHint")}>
        {settingsError !== null ? (
          <Alert variant="error" description={t("paseoPlusPlus.loadFailed")}>
            <Button variant="outline" size="sm" onPress={retryLoad}>
              {t("common.actions.retry")}
            </Button>
          </Alert>
        ) : null}
        <SettingsCard testID="paseo-plus-plus-features">
          {OPTIONAL_FEATURES.filter(
            (feature) => feature !== "androidAutomaticUpdateChecks" || Platform.OS === "android",
          ).map((feature) => (
            <FeatureSwitch
              key={feature}
              feature={feature}
              value={settings.paseoPlusPlus[feature]}
              disabled={isLoading || settingsError !== null || pending !== null}
              pending={pending === feature}
              failed={failed === feature}
              onChange={changeFeature}
            />
          ))}
        </SettingsCard>
      </SettingsSection>
      <ExplorerSection />
      <SettingsSection
        title={t("paseoPlusPlus.preferences")}
        info={t("paseoPlusPlus.preferencesHint")}
      >
        <SettingsCard>
          <SettingsRow
            label={t("paseoPlusPlus.links.sidebar.label")}
            hint={t("paseoPlusPlus.links.sidebar.hint")}
          />
          <UpdatePreferenceAction />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title={t("paseoPlusPlus.additions")} info={t("paseoPlusPlus.additionsHint")}>
        <SettingsCard>
          {ADDITIONS.map((addition) => (
            <SettingsRow
              key={addition}
              label={t(`paseoPlusPlus.additionsList.${addition}.label`)}
              hint={t(`paseoPlusPlus.additionsList.${addition}.hint`)}
            />
          ))}
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title={t("paseoPlusPlus.fixes")} info={t("paseoPlusPlus.fixesHint")}>
        <SettingsCard>
          {FIXES.map((fix) => (
            <SettingsRow
              key={fix}
              label={t(`paseoPlusPlus.fixesList.${fix}.label`)}
              hint={t(`paseoPlusPlus.fixesList.${fix}.hint`)}
            />
          ))}
        </SettingsCard>
      </SettingsSection>
    </View>
  );
}

interface FeatureSwitchProps {
  feature: PaseoPlusPlusFeature;
  value: boolean;
  disabled: boolean;
  pending: boolean;
  failed: boolean;
  onChange: (feature: PaseoPlusPlusFeature, enabled: boolean) => Promise<void>;
}

/** Give each mapped switch a stable callback and show its save state in place. */
function FeatureSwitch({
  feature,
  value,
  disabled,
  pending,
  failed,
  onChange,
}: FeatureSwitchProps) {
  const { t } = useTranslation();
  const change = useCallback(
    (enabled: boolean) => void onChange(feature, enabled),
    [feature, onChange],
  );
  return (
    <SettingsSwitch
      testID={`paseo-plus-plus-${feature}`}
      label={t(`paseoPlusPlus.features.${feature}.label`)}
      hint={pending ? t("paseoPlusPlus.saving") : t(`paseoPlusPlus.features.${feature}.hint`)}
      value={value}
      disabled={disabled}
      onValueChange={change}
      error={failed ? t("paseoPlusPlus.saveFailed") : undefined}
    />
  );
}

/** Navigate to the single existing control rather than maintaining a second setting. */
function UpdatePreferenceAction() {
  const { t } = useTranslation();
  const router = useRouter();
  const open = useCallback(() => router.push(buildSettingsSectionRoute("about")), [router]);
  if (!getIsElectron() && androidUpdaterNative === null) {
    return (
      <SettingsRow
        testID="paseo-plus-plus-updates-info"
        label={t("paseoPlusPlus.links.updates.label")}
        hint={t("paseoPlusPlus.links.updates.hint")}
      />
    );
  }
  return (
    <SettingsAction
      testID="paseo-plus-plus-link-updates"
      label={t("paseoPlusPlus.links.updates.label")}
      hint={t("paseoPlusPlus.links.updates.hint")}
      actionLabel={t("paseoPlusPlus.configure")}
      onPress={open}
    />
  );
}
