import { SettingsExample } from "@/components/settings/settings-example";
import { DEFAULT_SIDEBAR_INITIAL_WORKSPACE_COUNT } from "@/hooks/use-settings/storage";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { SettingsCard, SettingsRow, SettingsSection, SettingsSelect } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { FormTextInput } from "@/components/ui/form-field";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useSettingsSave } from "@/hooks/use-settings/use-settings-save";
import { parseSidebarWorkspaceCount } from "@/components/sidebar/workspace-limit";

/** Save an arbitrary initial group size or Show all without resetting individual group expansion. */
export function SidebarLimitSection() {
  const { t } = useTranslation();
  const compact = useIsCompactFormFactor();
  const { settings, save, pending, failed, isLoading, error } = useSettingsSave<"mode" | "count">();
  const count = settings.sidebarInitialWorkspaceCount;
  const input = useRef<EditingTextInputHandle>(null);
  const lastNumericCount = useRef(count ?? DEFAULT_SIDEBAR_INITIAL_WORKSPACE_COUNT);
  const [draft, setDraft] = useState(String(count ?? DEFAULT_SIDEBAR_INITIAL_WORKSPACE_COUNT));
  const [invalid, setInvalid] = useState(false);
  const disabled = isLoading || error !== null || pending !== null;
  const mode = count === null ? "all" : "limited";
  const options = useMemo(
    () => [
      { value: "limited", label: t("paseoPlusPlus.workspaceLimit.limited") },
      { value: "all", label: t("paseoPlusPlus.workspaceLimit.all") },
    ],
    [t],
  );

  const help = useMemo(
    () => ({
      mode: (
        <SettingsExample
          title={t("paseoPlusPlus.workspaceLimit.label")}
          caption={t("paseoPlusPlus.examples.workspaceLimit")}
          testID="settings-example-workspace-limit-mode"
        />
      ),
      count: (
        <SettingsExample
          title={t("paseoPlusPlus.workspaceLimit.count")}
          caption={t("paseoPlusPlus.examples.workspaceLimit")}
          testID="settings-example-workspace-limit-count"
        />
      ),
    }),
    [t],
  );

  // A remote saved value updates this field, while Show all retains the last numeric draft.
  useEffect(() => {
    if (count === null) return;
    lastNumericCount.current = count;
    const text = String(count);
    setDraft(text);
    setInvalid(false);
    input.current?.replaceText(text);
  }, [count]);

  const changeMode = useCallback(
    (nextMode: string) => {
      if (nextMode === mode) return;
      let nextCount: number | null = null;
      if (nextMode === "limited") nextCount = lastNumericCount.current;
      void save("mode", { sidebarInitialWorkspaceCount: nextCount });
    },
    [mode, save],
  );
  const changeDraft = useCallback((text: string) => {
    setDraft(text);
    setInvalid(false);
  }, []);
  const saveCount = useCallback(() => {
    const nextCount = parseSidebarWorkspaceCount(draft);
    if (nextCount === null) {
      setInvalid(true);
      return;
    }
    void save("count", { sidebarInitialWorkspaceCount: nextCount });
  }, [draft, save]);

  let feedback: string | undefined;
  if (invalid) feedback = t("paseoPlusPlus.workspaceLimit.invalid");
  else if (failed === "count") feedback = t("paseoPlusPlus.saveFailed");

  return (
    <SettingsSection title={t("paseoPlusPlus.workspaceLimit.title")}>
      <SettingsCard>
        <SettingsSelect
          label={t("paseoPlusPlus.workspaceLimit.label")}
          labelAccessory={help.mode}
          hint={pending === "mode" ? t("paseoPlusPlus.saving") : undefined}
          error={failed === "mode" ? t("paseoPlusPlus.saveFailed") : undefined}
          value={mode}
          options={options}
          onValueChange={changeMode}
          disabled={disabled}
          testID="sidebar-workspace-limit-mode"
        />
        {count !== null ? (
          <SettingsRow
            label={t("paseoPlusPlus.workspaceLimit.count")}
            error={feedback}
            labelAccessory={help.count}
          >
            <View style={styles.controls}>
              <FormTextInput
                ref={input}
                initialValue={draft}
                onChangeText={changeDraft}
                onSubmitEditing={saveCount}
                editable={!disabled}
                keyboardType="number-pad"
                inputMode="numeric"
                selectTextOnFocus
                size={compact ? "md" : "sm"}
                style={styles.input}
                accessibilityLabel={t("paseoPlusPlus.workspaceLimit.count")}
                testID="sidebar-workspace-limit-count"
              />
              <Button
                size="sm"
                onPress={saveCount}
                disabled={disabled}
                testID="sidebar-workspace-limit-save"
              >
                {pending === "count"
                  ? t("paseoPlusPlus.saving")
                  : t("paseoPlusPlus.workspaceLimit.save")}
              </Button>
            </View>
          </SettingsRow>
        ) : null}
      </SettingsCard>
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  controls: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  input: { width: 96, textAlign: "right" },
}));
