import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { Switch } from "@/components/ui/switch";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import type { WorktreeFormModel } from "./worktree-form-model";

/** Shared native/web fields dispatch edits to the model, preserving manually entered names. */
export function WorktreeFields({
  model,
  compact,
  disabled,
  visible,
}: {
  model: WorktreeFormModel;
  compact: boolean;
  disabled: boolean;
  visible: boolean;
}) {
  const state = useSyncExternalStore(model.subscribe, model.getState);
  const nameInput = useRef<EditingTextInputHandle>(null);
  useEffect(() => {
    // User edits already live in the editor; only replace reactive defaults.
    if (nameInput.current?.getText() !== state.worktreeName) {
      nameInput.current?.replaceText(state.worktreeName);
    }
  }, [state.worktreeName]);
  const separateNamesSwitch = useMemo(
    () => (
      <Switch
        value={state.separateNames}
        onValueChange={model.setSeparateNames}
        disabled={disabled}
        accessibilityLabel="Use a different branch name"
        testID="new-workspace-separate-names"
      />
    ),
    [state.separateNames, model, disabled],
  );
  if (!visible) return null;
  const size = compact ? "md" : "sm";
  const newBranch = state.mode === "branch-off";
  const nameLabel =
    newBranch && !state.separateNames ? "Worktree and branch name" : "Worktree name";
  return (
    <View style={styles.fields}>
      <View style={styles.nameRow}>
        <View style={styles.nameField}>
          <Field label={nameLabel}>
            <FormTextInput
              ref={nameInput}
              initialValue={state.worktreeName}
              onChangeText={model.setWorktreeName}
              size={size}
              editable={!disabled}
              autoCapitalize="none"
              accessibilityLabel={nameLabel}
              testID="new-workspace-worktree-name"
            />
          </Field>
        </View>
        {newBranch && state.separateNames ? (
          <View style={styles.nameField}>
            <Field label="New branch name">
              <FormTextInput
                key="separate-branch"
                initialValue={state.branchName}
                onChangeText={model.setBranchName}
                size={size}
                editable={!disabled}
                autoCapitalize="none"
                accessibilityLabel="New branch name"
                testID="new-workspace-branch-name"
              />
            </Field>
          </View>
        ) : null}
      </View>
      {newBranch ? (
        <Field label="Use a different branch name" trailing={separateNamesSwitch}>
          {null}
        </Field>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  nameRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  nameField: {
    flexGrow: 1,
    flexBasis: 220,
    minWidth: 0,
  },
  fields: {
    gap: theme.spacing[2],
    marginBottom: theme.spacing[4],
    paddingHorizontal: theme.spacing[6],
  },
}));
