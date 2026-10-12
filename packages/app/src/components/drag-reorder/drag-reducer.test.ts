import {
  commitDragCompletion,
  type DragSessionSnapshot,
} from "react-native-draggable-flatlist/src/drag-session";
import { describe, expect, it } from "vitest";
import { dragStateInitial, dragStateReducer } from "./drag-reducer";

describe("dragStateReducer", () => {
  it("starts tracking the active item with a snapshot of the data", () => {
    const next = dragStateReducer(dragStateInitial<string>(), {
      type: "start",
      id: "alpha",
      data: ["alpha", "beta"],
    });

    expect(next).toEqual({ activeId: "alpha", dragItems: ["alpha", "beta"] });
  });

  it("clears the active item and the snapshot", () => {
    const next = dragStateReducer(
      { activeId: "alpha", dragItems: ["alpha", "beta"] },
      { type: "clear" },
    );

    expect(next).toEqual({ activeId: null, dragItems: null });
  });

  it("replaces an in-flight drag when a new one starts", () => {
    const next = dragStateReducer(
      { activeId: "alpha", dragItems: ["alpha", "beta"] },
      { type: "start", id: "beta", data: ["beta", "gamma"] },
    );

    expect(next).toEqual({ activeId: "beta", dragItems: ["beta", "gamma"] });
  });
});

describe("native settling drag identity", () => {
  const keys = ["A", "B", "C"];
  const session: DragSessionSnapshot = {
    sessionId: 7,
    key: "A",
    index: 0,
    revision: 1,
    orderedKeys: keys,
  };

  it("commits the original dragged key after an unchanged, finished spring", () => {
    const stored = { keys: [...keys], mode: "status" };
    const committed = commitDragCompletion({
      session,
      completion: { sessionId: 7, from: 0, to: 2, finished: true },
      revision: 1,
      orderedKeys: keys,
      onCommit: ({ from, to }) => {
        const [item] = stored.keys.splice(from, 1);
        stored.keys.splice(to, 0, item!);
        stored.mode = "custom";
      },
    });
    expect(committed).toBe(true);
    expect(stored).toEqual({ keys: ["B", "C", "A"], mode: "custom" });
  });

  it.each([
    {
      label: "a new X enters ahead of released A",
      orderedKeys: ["X", "A", "B", "C"],
      revision: 2,
      finished: true,
      sessionId: 7,
    },
    {
      label: "another row changes order while A settles",
      orderedKeys: ["B", "A", "C"],
      revision: 2,
      finished: true,
      sessionId: 7,
    },
    {
      label: "membership returns to its earlier order under a new revision",
      orderedKeys: keys,
      revision: 3,
      finished: true,
      sessionId: 7,
    },
    {
      label: "the settling spring is canceled",
      orderedKeys: keys,
      revision: 1,
      finished: false,
      sessionId: 7,
    },
    {
      label: "a newer drag owns the callback",
      orderedKeys: keys,
      revision: 1,
      finished: true,
      sessionId: 8,
    },
  ])(
    "does not reorder unrelated rows or switch to Custom when $label",
    ({ orderedKeys, revision, finished, sessionId }) => {
      const stored = { keys: [...orderedKeys], mode: "status", commits: 0 };
      const committed = commitDragCompletion({
        session,
        completion: { sessionId, from: 0, to: 2, finished },
        revision,
        orderedKeys,
        onCommit: ({ from, to }) => {
          const [item] = stored.keys.splice(from, 1);
          stored.keys.splice(to, 0, item!);
          stored.mode = "custom";
          stored.commits++;
        },
      });
      expect(committed).toBe(false);
      expect(stored).toEqual({ keys: orderedKeys, mode: "status", commits: 0 });
    },
  );
});
