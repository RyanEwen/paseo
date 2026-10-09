import { createWorkingDiffComparisonStore } from "./index";
import { createInMemoryKeyValueStorage } from "@/hooks/use-settings/fakes";
import { describe, expect, it } from "vitest";
import {
  expireWorkingDiffComparisonsInState,
  resolveWorkingDiffComparisonFromState,
  selectWorkingDiffComparisonInState,
  type WorkingDiffComparisonState,
  workingDiffComparisonKey,
} from "./state";

const checkout = {
  serverId: "server-1",
  workspaceId: "workspace-1",
  cwd: "/repo",
  policy: { defaultComparison: "uncommitted" as const, autoSwitch: true },
};

function emptyState(): WorkingDiffComparisonState {
  return { overrides: {} };
}

describe("working diff comparison", () => {
  it("restores the selected comparison after the app reloads", async () => {
    const storage = createInMemoryKeyValueStorage();
    const source = createWorkingDiffComparisonStore(storage);
    await source.persist.rehydrate();
    source.getState().select({ ...checkout, comparison: "base", isDirty: false });
    const restored = createWorkingDiffComparisonStore(storage);
    await restored.persist.rehydrate();
    expect(
      resolveWorkingDiffComparisonFromState(restored.getState(), {
        ...checkout,
        policy: undefined,
        isDirty: true,
      }),
    ).toBe("base");
  });

  it("defaults to uncommitted regardless of dirtiness unless a different default is configured", () => {
    expect(
      resolveWorkingDiffComparisonFromState(emptyState(), {
        ...checkout,
        policy: undefined,
        isDirty: false,
      }),
    ).toBe("uncommitted");
    expect(
      resolveWorkingDiffComparisonFromState(emptyState(), {
        ...checkout,
        policy: { defaultComparison: "base", autoSwitch: false },
        isDirty: true,
      }),
    ).toBe("base");
  });

  it("keeps manual comparisons across dirty transitions when automatic switching is off", () => {
    const state = selectWorkingDiffComparisonInState(emptyState(), {
      ...checkout,
      comparison: "uncommitted",
      isDirty: true,
    });
    expect(
      resolveWorkingDiffComparisonFromState(state, {
        ...checkout,
        policy: undefined,
        isDirty: false,
      }),
    ).toBe("uncommitted");
    const committed = selectWorkingDiffComparisonInState(state, {
      ...checkout,
      comparison: "base",
      isDirty: false,
    });
    expect(
      resolveWorkingDiffComparisonFromState(committed, {
        ...checkout,
        policy: undefined,
        isDirty: true,
      }),
    ).toBe("base");
  });

  it("scopes selection to the workspace checkout rather than a panel", () => {
    expect(workingDiffComparisonKey(checkout)).toBe(
      "working-diff:server=server-1:workspace=workspace-1",
    );
    expect(workingDiffComparisonKey({ ...checkout, workspaceId: "workspace-2" })).not.toBe(
      workingDiffComparisonKey(checkout),
    );
    expect(workingDiffComparisonKey({ ...checkout, workspaceId: null, cwd: "/repo/" })).toBe(
      "working-diff:server=server-1:cwd=%2Frepo",
    );
  });

  it("defaults from checkout dirtiness and honors a matching manual selection", () => {
    expect(
      resolveWorkingDiffComparisonFromState(emptyState(), { ...checkout, isDirty: true }),
    ).toBe("uncommitted");
    expect(
      resolveWorkingDiffComparisonFromState(emptyState(), { ...checkout, isDirty: false }),
    ).toBe("base");

    const selected = selectWorkingDiffComparisonInState(emptyState(), {
      ...checkout,
      comparison: "base",
      isDirty: true,
    });
    expect(resolveWorkingDiffComparisonFromState(selected, { ...checkout, isDirty: true })).toBe(
      "base",
    );
  });

  it("masks and expires stale selections for every workspace on the checkout", () => {
    let state = selectWorkingDiffComparisonInState(emptyState(), {
      ...checkout,
      comparison: "base",
      isDirty: true,
    });
    state = selectWorkingDiffComparisonInState(state, {
      ...checkout,
      workspaceId: "workspace-2",
      comparison: "uncommitted",
      isDirty: false,
    });
    state = selectWorkingDiffComparisonInState(state, {
      serverId: "server-2",
      workspaceId: "workspace-3",
      cwd: "/other",
      comparison: "base",
      isDirty: true,
    });

    expect(resolveWorkingDiffComparisonFromState(state, { ...checkout, isDirty: false })).toBe(
      "base",
    );
    const expired = expireWorkingDiffComparisonsInState(state, {
      serverId: checkout.serverId,
      cwd: checkout.cwd,
      isDirty: false,
    });
    expect(expired.overrides[workingDiffComparisonKey(checkout)]).toBeUndefined();
    expect(
      expired.overrides[workingDiffComparisonKey({ ...checkout, workspaceId: "workspace-2" })],
    ).toBeDefined();
    expect(
      expired.overrides[
        workingDiffComparisonKey({
          serverId: "server-2",
          workspaceId: "workspace-3",
          cwd: "/other",
        })
      ],
    ).toBeDefined();
  });

  it("keeps state identity when nothing expires", () => {
    const state = selectWorkingDiffComparisonInState(emptyState(), {
      ...checkout,
      comparison: "base",
      isDirty: true,
    });
    expect(
      expireWorkingDiffComparisonsInState(state, {
        serverId: checkout.serverId,
        cwd: checkout.cwd,
        isDirty: true,
      }),
    ).toBe(state);
  });
});
