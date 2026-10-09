import { useCallback, useEffect, useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { persist, type StateStorage } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import { queryClient } from "@/data/query-client";
import { useAppSettings } from "@/hooks/use-settings";
import {
  APP_SETTINGS_QUERY_KEY,
  DEFAULT_CLIENT_SETTINGS,
  type AppSettings,
} from "@/hooks/use-settings/storage";
import { create } from "zustand";
import {
  expireWorkingDiffComparisonsInState,
  resolveWorkingDiffComparisonFromState,
  selectWorkingDiffComparisonInState,
  WorkingDiffComparisonOverrideSchema,
  type WorkingDiffComparisonPolicy,
  type WorkingDiffCheckoutIdentity,
  type WorkingDiffComparison,
  type WorkingDiffComparisonState,
} from "./state";

interface WorkingDiffComparisonStore extends WorkingDiffComparisonState {
  select: (
    input: WorkingDiffCheckoutIdentity & {
      comparison: WorkingDiffComparison;
      isDirty: boolean;
    },
  ) => void;
}

const comparisonStateSchema = z.strictObject({
  overrides: z.record(z.string(), WorkingDiffComparisonOverrideSchema),
});

/** Persists manual comparisons independently of tabs so all Changes surfaces share them. */
export function createWorkingDiffComparisonStore(storage: StateStorage = AsyncStorage) {
  return create<WorkingDiffComparisonStore>()(
    persist(
      (set) => ({
        overrides: {},
        select: (input) => set((state) => selectWorkingDiffComparisonInState(state, input)),
      }),
      {
        name: "working-diff-comparisons",
        storage: createValidatedPersistStorage(storage, comparisonStateSchema),
        partialize: ({ overrides }) => ({ overrides }),
      },
    ),
  );
}

const useWorkingDiffComparisonStore = createWorkingDiffComparisonStore();

/** Reads the same policy for React consumers and checkout-status boundary updates. */
function comparisonPolicy(settings: AppSettings): WorkingDiffComparisonPolicy {
  return {
    defaultComparison: settings.workingDiffDefaultComparison,
    autoSwitch: settings.workingDiffAutoSwitch,
  };
}

function currentComparisonPolicy(): WorkingDiffComparisonPolicy {
  const settings =
    queryClient.getQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY) ?? DEFAULT_CLIENT_SETTINGS;
  return comparisonPolicy(settings);
}

/** Shares a hydrated comparison and remembers explicit selections for this workspace. */
export function useWorkingDiffComparison(
  input: WorkingDiffCheckoutIdentity & { isDirty: boolean; statusReady: boolean },
): {
  comparison: WorkingDiffComparison;
  isLoading: boolean;
  selectComparison: (comparison: WorkingDiffComparison) => void;
} {
  const { serverId, workspaceId, cwd, isDirty, statusReady } = input;
  const { settings, isLoading } = useAppSettings();
  const hydrated = useSyncExternalStore(
    useWorkingDiffComparisonStore.persist.onFinishHydration,
    useWorkingDiffComparisonStore.persist.hasHydrated,
    useWorkingDiffComparisonStore.persist.hasHydrated,
  );
  const policy = comparisonPolicy(settings);
  const comparison = useWorkingDiffComparisonStore((state) =>
    resolveWorkingDiffComparisonFromState(state, { serverId, workspaceId, cwd, isDirty, policy }),
  );
  // Initial checkout status may arrive before persisted choices hydrate. Reconcile that
  // boundary again once both stores are ready so an expired automatic choice cannot return.
  useEffect(() => {
    if (hydrated && !isLoading && statusReady && policy.autoSwitch) {
      expireWorkingDiffComparisons({ serverId, cwd, isDirty });
    }
  }, [hydrated, isLoading, statusReady, policy.autoSwitch, serverId, cwd, isDirty]);
  const select = useWorkingDiffComparisonStore((state) => state.select);
  const selectComparison = useCallback(
    (next: WorkingDiffComparison) =>
      select({ serverId, workspaceId, cwd, isDirty, comparison: next }),
    [cwd, isDirty, select, serverId, workspaceId],
  );
  return { comparison, selectComparison, isLoading: isLoading || !hydrated };
}

export function selectWorkingDiffComparison(
  input: WorkingDiffCheckoutIdentity & {
    comparison: WorkingDiffComparison;
    isDirty: boolean;
  },
): void {
  useWorkingDiffComparisonStore.getState().select(input);
}

export function resolveWorkingDiffComparison(
  input: WorkingDiffCheckoutIdentity & { isDirty: boolean },
): WorkingDiffComparison {
  return resolveWorkingDiffComparisonFromState(useWorkingDiffComparisonStore.getState(), {
    ...input,
    policy: currentComparisonPolicy(),
  });
}

export function expireWorkingDiffComparisons(input: {
  serverId: string;
  cwd: string;
  isDirty: boolean;
}): void {
  if (!currentComparisonPolicy().autoSwitch) {
    return;
  }
  const current = useWorkingDiffComparisonStore.getState();
  const next = expireWorkingDiffComparisonsInState(current, input);
  // Persist middleware writes even when a setter returns the existing state. Checkout
  // updates are frequent, so leave storage alone unless a manual selection expired.
  if (next !== current) {
    useWorkingDiffComparisonStore.setState(next);
  }
}

export function resetWorkingDiffComparisons(): void {
  useWorkingDiffComparisonStore.setState({ overrides: {} });
}
