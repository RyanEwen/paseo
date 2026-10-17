import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MenuHint, MenuItem, MenuLabel, MenuSubTrigger, MenuTextField } from "@/components/ui/menu";
import { parseSidebarWorkspaceCount } from "@/components/sidebar/workspace-limit";

/** These ports are supplied by the parent-owned active-mode preferences hook. */
export interface WorkspaceListPreferences {
  grouping: "project" | "status";
  preferencesDisabled: boolean;
  preferencesDisabledReason: string | null;
  initialWorkspaceCount: number | null;
  setInitialWorkspaceCount(count: number | null): void;
  workspaceUpdatedWithinDays: number | null;
  setWorkspaceUpdatedWithinDays(days: number | null): void;
}
const COUNTS = [null, 5, 10, 15, 20, 25, 50] as const;
const AGE_OPTIONS = [null, 1, 2, 3, 5, 7, 14, 30, 60, 90] as const;
const AGE_LABELS = {
  1: "day",
  2: "twoDays",
  3: "threeDays",
  5: "fiveDays",
  7: "week",
  14: "twoWeeks",
  30: "month",
  60: "twoMonths",
  90: "threeMonths",
} as const;

export function WorkspaceUpdatedWithinPage({
  preferences,
}: {
  preferences: WorkspaceListPreferences;
}) {
  const { t } = useTranslation();
  return (
    <>
      {AGE_OPTIONS.map((days) => (
        <WorkspaceLimitOption
          disabled={preferences.preferencesDisabled}
          key={String(days)}
          value={days}
          selected={preferences.workspaceUpdatedWithinDays === days}
          onChange={preferences.setWorkspaceUpdatedWithinDays}
          testID={`sidebar-workspace-updated-${days ?? "all"}`}
        >
          {days === null
            ? t("paseoPlusPlus.workspaceLimit.all")
            : t(`sidebar.display.workspaceList.${AGE_LABELS[days]}`)}
        </WorkspaceLimitOption>
      ))}
    </>
  );
}
export function WorkspaceListPage({ preferences }: { preferences: WorkspaceListPreferences }) {
  const { t } = useTranslation();
  return (
    <>
      <MenuSubTrigger
        disabled={preferences.preferencesDisabled}
        id="workspaceCount"
        testID="sidebar-workspace-count-limit"
      >
        {t("sidebar.display.workspaceList.countLimit")}
      </MenuSubTrigger>
      <MenuSubTrigger
        disabled={preferences.preferencesDisabled}
        id="workspaceUpdatedWithin"
        testID="sidebar-workspace-updated-within"
      >
        {t("sidebar.display.workspaceList.updatedWithin")}
      </MenuSubTrigger>
    </>
  );
}
export function WorkspaceCountPage({ preferences }: { preferences: WorkspaceListPreferences }) {
  const lastNumeric = useRef<Record<"project" | "status", number>>({ project: 20, status: 20 });
  if (preferences.initialWorkspaceCount !== null)
    lastNumeric.current[preferences.grouping] = preferences.initialWorkspaceCount;
  return (
    <WorkspaceListEditor
      key={`${preferences.grouping}:${preferences.initialWorkspaceCount ?? "all"}`}
      preferences={preferences}
      numericDraft={lastNumeric.current[preferences.grouping]}
    />
  );
}
function WorkspaceListEditor({
  preferences,
  numericDraft,
}: {
  preferences: WorkspaceListPreferences;
  numericDraft: number;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(String(preferences.initialWorkspaceCount ?? numericDraft));
  const [invalid, setInvalid] = useState(false);
  const change = useCallback((value: string) => {
    setDraft(value);
    setInvalid(false);
  }, []);
  const save = useCallback(() => {
    const value = parseSidebarWorkspaceCount(draft);
    if (value === null) {
      setInvalid(true);
      return;
    }
    preferences.setInitialWorkspaceCount(value);
  }, [draft, preferences]);
  return (
    <>
      <MenuLabel>{t("paseoPlusPlus.workspaceLimit.label")}</MenuLabel>
      {COUNTS.map((count) => (
        <WorkspaceLimitOption
          disabled={preferences.preferencesDisabled}
          key={String(count)}
          value={count}
          selected={preferences.initialWorkspaceCount === count}
          onChange={preferences.setInitialWorkspaceCount}
          testID={`sidebar-workspace-count-${count ?? "all"}`}
        >
          {count === null ? t("paseoPlusPlus.workspaceLimit.all") : String(count)}
        </WorkspaceLimitOption>
      ))}
      <MenuTextField
        editable={!preferences.preferencesDisabled}
        initialValue={draft}
        onChangeText={change}
        placeholder={t("paseoPlusPlus.workspaceLimit.count")}
        onSubmitEditing={save}
        testID="sidebar-workspace-count-custom"
      />
      {invalid ? <MenuHint>{t("paseoPlusPlus.workspaceLimit.invalid")}</MenuHint> : null}
      <MenuItem
        disabled={preferences.preferencesDisabled}
        onSelect={save}
        closeOnSelect={false}
        testID="sidebar-workspace-count-save"
      >
        {t("paseoPlusPlus.workspaceLimit.save")}
      </MenuItem>
    </>
  );
}

function WorkspaceLimitOption({
  value,
  onChange,
  children,
  ...props
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  children: string;
  disabled: boolean;
  selected: boolean;
  testID: string;
}) {
  const select = useCallback(() => onChange(value), [onChange, value]);
  return (
    <MenuItem {...props} onSelect={select} closeOnSelect={false}>
      {children}
    </MenuItem>
  );
}
