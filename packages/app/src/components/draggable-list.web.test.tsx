/**
 * @vitest-environment jsdom
 */
import { SidebarPinnedList } from "@/components/sidebar/pinned-list";
import { useSidebarQuickFilterStore } from "@/stores/sidebar-quick-filter-store";
import { ProjectPinGutterProvider, WorkspaceProjectPinGutter } from "./sidebar/project-pin-gutter";
import { useSidebarReorderGuard } from "@/hooks/use-sidebar-reorder-guard";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import type { Active, ClientRect, Over, DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { useDragReorderState, type DragReorderState } from "./drag-reorder/use-drag-reorder-state";
import type { DragReorderMove } from "./drag-reorder/reorder-items";
import React, { memo } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DraggableListDragHandleProps } from "./draggable-list.types";
import { DraggableList, type DraggableRenderItemInfo } from "./draggable-list.web";

interface Item {
  id: string;
}

const items: Item[] = [{ id: "one" }];

function keyExtractor(item: Item): string {
  return item.id;
}

function onDragEnd() {}

let root: Root | null = null;
let container: HTMLElement | null = null;
let rowRenderCount = 0;

const Row = memo(function Row({
  dragHandleProps: _dragHandleProps,
}: {
  dragHandleProps?: DraggableListDragHandleProps;
}) {
  rowRenderCount += 1;
  return <div>row</div>;
});

function renderRow(info: DraggableRenderItemInfo<Item>) {
  return <Row dragHandleProps={info.dragHandleProps} />;
}

function renderReplacementRow(info: DraggableRenderItemInfo<Item>) {
  return <Row dragHandleProps={info.dragHandleProps} />;
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  rowRenderCount = 0;
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe("DraggableList web row stability", () => {
  it("keeps drag handle props stable when the render callback changes", () => {
    act(() => {
      root?.render(
        <DraggableList
          data={items}
          keyExtractor={keyExtractor}
          renderItem={renderRow}
          onDragEnd={onDragEnd}
          useDragHandle
        />,
      );
    });
    expect(rowRenderCount).toBe(1);

    act(() => {
      root?.render(
        <DraggableList
          data={items}
          keyExtractor={keyExtractor}
          renderItem={renderReplacementRow}
          onDragEnd={onDragEnd}
          useDragHandle
        />,
      );
    });

    expect(rowRenderCount).toBe(1);
  });
});

let rowActionClicks = 0;
function handleRowActionClick() {
  rowActionClicks += 1;
}
function renderActionRow(info: DraggableRenderItemInfo<Item>) {
  return (
    <div {...info.dragHandleProps?.attributes} {...info.dragHandleProps?.listeners}>
      <button type="button" onClick={handleRowActionClick}>
        Workspace actions
      </button>
    </div>
  );
}

it.each([false, true])(
  "keeps row actions enabled when dragging is disabled (handle=%s)",
  (useDragHandle) => {
    rowActionClicks = 0;
    act(() =>
      root?.render(
        <DraggableList
          disabled
          data={items}
          keyExtractor={keyExtractor}
          renderItem={renderActionRow}
          onDragEnd={onDragEnd}
          useDragHandle={useDragHandle}
        />,
      ),
    );
    const button = container!.querySelector("button")!;
    expect(button.closest('[aria-disabled="true"]')).toBeNull();
    act(() => button.click());
    expect(rowActionClicks).toBe(1);
  },
);

let dragModel: DragReorderState<Item> | null = null;
function DragStateHarness({
  data,
  dropped,
  disabled = false,
}: {
  data: Item[];
  dropped: (items: Item[], move?: DragReorderMove) => void;
  disabled?: boolean;
}) {
  dragModel = useDragReorderState({ data, keyExtractor, onDragEnd: dropped, disabled });
  return null;
}

describe("drag result identity", () => {
  it("passes actual active/from/to/anchor from the drag snapshot even if rendered data changes", () => {
    const dropped = vi.fn();
    const original = [{ id: "one" }, { id: "two" }, { id: "three" }];
    act(() => root?.render(<DragStateHarness data={original} dropped={dropped} />));
    act(() => dragModel!.handlers.onDragStart({ active: { id: "one" } } as DragStartEvent));
    act(() =>
      root?.render(<DragStateHarness data={[{ id: "new" }, ...original]} dropped={dropped} />),
    );
    act(() =>
      dragModel!.handlers.onDragEnd({
        active: { id: "one" },
        over: { id: "three" },
      } as DragEndEvent),
    );
    expect(dropped).toHaveBeenCalledExactlyOnceWith([original[1], original[2], original[0]], {
      activeKey: "one",
      overKey: "three",
      from: 0,
      to: 2,
    });
  });
  it("does not emit an order or move for a cancelled drop", () => {
    const dropped = vi.fn();
    act(() => root?.render(<DragStateHarness data={items} dropped={dropped} />));
    act(() => dragModel!.handlers.onDragStart({ active: { id: "one" } } as DragStartEvent));
    act(() => dragModel!.handlers.onDragEnd({ active: { id: "one" }, over: null } as DragEndEvent));
    expect(dropped).not.toHaveBeenCalled();
  });
});

it("does not begin or finish a reorder when the list is disabled", () => {
  const dropped = vi.fn();
  const data = [{ id: "one" }, { id: "two" }];
  act(() => root?.render(<DragStateHarness data={data} dropped={dropped} disabled />));
  act(() => dragModel!.handlers.onDragStart({ active: { id: "one" } } as DragStartEvent));
  expect(dragModel!.activeId).toBeNull();
  act(() =>
    dragModel!.handlers.onDragEnd({ active: { id: "one" }, over: { id: "two" } } as DragEndEvent),
  );
  expect(dropped).not.toHaveBeenCalled();
});

let reorderGuard: ReturnType<typeof useSidebarReorderGuard> | null = null;
function ReorderGuardHarness() {
  reorderGuard = useSidebarReorderGuard("workspace");
  return null;
}

it("rejects a drop when its sorting changes away and back without issuing preference commands", async () => {
  useSidebarViewStore.setState({ groupMode: "project", workspaceSortMode: "custom" });
  const originalCommand = useSidebarViewStore.getState().setModePreferences;
  const commands = vi.spyOn(useSidebarViewStore.getState(), "setModePreferences");
  await act(() => root?.render(<ReorderGuardHarness />));
  await act(() => reorderGuard!.onDragBegin());
  expect(reorderGuard!.canCommit()).toBe(true);
  await act(() => useSidebarViewStore.setState({ workspaceSortMode: "name" }));
  expect(reorderGuard!.disabled).toBe(true);
  expect(reorderGuard!.canCommit()).toBe(false);
  await act(() => useSidebarViewStore.setState({ workspaceSortMode: "custom" }));
  expect(reorderGuard!.canCommit()).toBe(false);
  expect(commands).not.toHaveBeenCalled();
  commands.mockRestore();
  useSidebarViewStore.setState({ setModePreferences: originalCommand });
});

it("keeps sorted manual pins available while rejecting ordinary and stale-mode drops", async () => {
  useSidebarViewStore.setState({ groupMode: "project", workspaceSortMode: "name" });
  await act(() => root?.render(<ReorderGuardHarness />));
  await act(() => reorderGuard!.onDragBegin());
  expect(reorderGuard!.canCommit()).toBe(false);
  expect(reorderGuard!.canCommit(true)).toBe(true);
  await act(() => useSidebarViewStore.setState({ groupMode: "status" }));
  expect(reorderGuard!.canCommit(true)).toBe(false);
});

it("invalidates a started reorder when transient quick text changes away and back", async () => {
  const state = useSidebarQuickFilterStore.getState();
  state.close("project");
  useSidebarViewStore.setState({ groupMode: "project", workspaceSortMode: "custom" });
  state.toggle("project");
  await act(async () => root?.render(<ReorderGuardHarness />));
  await act(() => reorderGuard!.onDragBegin());
  expect(reorderGuard!.canCommit()).toBe(true);
  await act(() => state.setText("project", "narrow"));
  await act(() => state.setText("project", ""));
  expect(reorderGuard!.canCommit()).toBe(false);
  await act(() => state.close("project"));
});

// Observe only dnd-kit event ports while retaining its real provider, the actual
// production pin/list owners and the actual web drag snapshot implementation.
let pinnedDndContext: {
  onDragStart?: (event: DragStartEvent) => void;
  onDragEnd?: (event: DragEndEvent) => void;
} | null = null;
vi.mock("@dnd-kit/core", async () => {
  const actual = await vi.importActual<typeof import("@dnd-kit/core")>("@dnd-kit/core");
  return {
    ...actual,
    DndContext: function ObservedDndContext(props: React.ComponentProps<typeof actual.DndContext>) {
      pinnedDndContext = props;
      return <actual.DndContext {...props} />;
    },
  };
});

function renderPinnedRow({ item }: DraggableRenderItemInfo<Item>) {
  return <div data-pin-row={item.id}>{item.id}</div>;
}

function createPinnedDragEvents(): { start: DragStartEvent; end: DragEndEvent } {
  const initial: ClientRect = { width: 100, height: 32, top: 0, left: 0, right: 100, bottom: 32 };
  const translated: ClientRect = { ...initial, top: 64, bottom: 96 };
  const active: Active = {
    id: "one",
    data: { current: {} },
    rect: { current: { initial, translated } },
  };
  const over: Over = {
    id: "three",
    rect: translated,
    disabled: false,
    data: { current: {} },
  };
  const activatorEvent = new Event("pointerdown");
  return {
    start: { active, activatorEvent },
    end: {
      active,
      activatorEvent,
      over,
      collisions: [{ id: over.id }],
      delta: { x: 0, y: 64 },
    },
  };
}

it.each(["project", "status"] as const)(
  "guards top-level %s pins without disabling their independent manual order",
  async (mode) => {
    const query = useSidebarQuickFilterStore.getState();
    query.close(mode);
    query.toggle(mode);
    useSidebarViewStore.setState({
      groupMode: mode,
      sortMode: "status",
      workspaceSortMode: "name",
    });
    const dropped = vi.fn();
    const dragEvents = createPinnedDragEvents();
    const original = [{ id: "one" }, { id: "two" }, { id: "three" }];
    const renderPins = (data: Item[]) => (
      <SidebarPinnedList
        data={data}
        keyExtractor={keyExtractor}
        renderItem={renderPinnedRow}
        onDragEnd={dropped}
      />
    );
    try {
      await act(() => root?.render(renderPins(original)));
      await act(() => pinnedDndContext!.onDragStart!(dragEvents.start));
      await act(() => pinnedDndContext!.onDragEnd!(dragEvents.end));
      expect(dropped).toHaveBeenCalledTimes(1);
      expect(dropped.mock.calls[0][0].map((item: Item) => item.id)).toEqual([
        "two",
        "three",
        "one",
      ]);

      await act(() => pinnedDndContext!.onDragStart!(dragEvents.start));
      await act(() => query.setText(mode, "narrow"));
      await act(() => root?.render(renderPins(original.slice(0, 2))));
      // Preserve the active snapshot, matching the production web owner during filtering.
      expect(
        Array.from(container!.querySelectorAll("[data-pin-row]")).map((row) =>
          row.getAttribute("data-pin-row"),
        ),
      ).toEqual(["one", "two", "three"]);
      await act(() => query.setText(mode, ""));
      await act(() => root?.render(renderPins(original)));
      await act(() => pinnedDndContext!.onDragEnd!(dragEvents.end));
      expect(dropped).toHaveBeenCalledTimes(1);
    } finally {
      await act(() => query.close(mode));
    }
  },
);
const PROJECT_PIN_RAIL_FIXTURE = {
  workspaceKey: "srv:project-pin",
  projectPinnedAt: "2026-10-16T00:00:00Z",
  pinnedAt: null,
};
const GLOBAL_PIN_RAIL_FIXTURE = {
  workspaceKey: "srv:global-pin",
  projectPinnedAt: null,
  pinnedAt: "2026-10-16T00:00:00Z",
};
const ORDINARY_PIN_RAIL_FIXTURE = {
  workspaceKey: "srv:ordinary",
  projectPinnedAt: null,
  pinnedAt: null,
};

it("paints only project pins without reserving another name rail", async () => {
  await act(() =>
    root?.render(
      <ProjectPinGutterProvider value={true}>
        <WorkspaceProjectPinGutter workspace={PROJECT_PIN_RAIL_FIXTURE} />
        <WorkspaceProjectPinGutter workspace={GLOBAL_PIN_RAIL_FIXTURE} />
        <WorkspaceProjectPinGutter workspace={ORDINARY_PIN_RAIL_FIXTURE} />
      </ProjectPinGutterProvider>,
    ),
  );
  expect(container!.querySelectorAll('[data-testid^="sidebar-project-pin-rail-"]')).toHaveLength(1);
  expect(
    container!
      .querySelector('[data-testid="sidebar-project-pin-rail-srv:project-pin"]')
      ?.getAttribute("style"),
  ).toContain("position: absolute");
  expect(
    container!.querySelector('[data-testid="sidebar-project-pin-icon-srv:project-pin"]'),
  ).not.toBeNull();
  expect(
    container!.querySelector('[data-testid="sidebar-project-pin-icon-srv:global-pin"]'),
  ).toBeNull();
  expect(
    container!.querySelector('[data-testid="sidebar-project-pin-icon-srv:ordinary"]'),
  ).toBeNull();
  await act(() =>
    root?.render(
      <ProjectPinGutterProvider value={false}>
        <WorkspaceProjectPinGutter workspace={PROJECT_PIN_RAIL_FIXTURE} />
      </ProjectPinGutterProvider>,
    ),
  );
  expect(container!.querySelector('[data-testid^="sidebar-project-pin-rail-"]')).toBeNull();
});

it("animates unchanged rows when surrounding groups collapse or expand and respects disabled motion", () => {
  let top = 0;
  const cancel = vi.fn();
  const animate = vi.fn(() => ({ cancel }));
  const properties = ["offsetTop", "offsetWidth", "getClientRects", "animate"] as const;
  const descriptors = properties.map((key) =>
    Object.getOwnPropertyDescriptor(HTMLElement.prototype, key),
  );
  Object.defineProperty(HTMLElement.prototype, "offsetTop", {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute("data-position-transition") ? top : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get: () => 100,
  });
  Object.defineProperty(HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value: () => [{ width: 100, height: 20 }],
  });
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
  const render = (revision: boolean, duration = 100) => (
    <DraggableList
      data={items}
      keyExtractor={keyExtractor}
      renderItem={renderRow}
      onDragEnd={onDragEnd}
      positionTransitionDuration={duration}
      positionTransitionRevision={revision}
    />
  );
  try {
    act(() => root?.render(render(false)));
    const node = container!.querySelector<HTMLElement>("[data-position-transition]")!;
    node.style.transform = "none";
    // Stable hydrated membership establishes the motion policy without moving a row.
    act(() => root?.render(render(false)));
    expect(animate).not.toHaveBeenCalled();
    top = -80;
    act(() => root?.render(render(true)));
    expect(animate).toHaveBeenLastCalledWith(
      [{ transform: "translateY(80px)" }, { transform: "translateY(0px)" }],
      { duration: 100, easing: "ease-in-out" },
    );
    top = 0;
    act(() => root?.render(render(false)));
    expect(animate).toHaveBeenLastCalledWith(
      [{ transform: "translateY(-80px)" }, { transform: "translateY(0px)" }],
      { duration: 100, easing: "ease-in-out" },
    );
    expect(cancel).toHaveBeenCalledTimes(1);
    top = 200;
    act(() => root?.render(render(true, 0)));
    expect(animate).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(container!.querySelector("[data-position-transition]")).toBe(node);
  } finally {
    properties.forEach((key, index) => {
      const descriptor = descriptors[index];
      if (descriptor) Object.defineProperty(HTMLElement.prototype, key, descriptor);
      else Reflect.deleteProperty(HTMLElement.prototype, key);
    });
  }
});
