/**
 * @vitest-environment jsdom
 */
import React, { createRef, useMemo, useCallback } from "react";
import { cleanup, fireEvent, render, act } from "@testing-library/react";
import { Text, Platform, type View } from "react-native";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MenuRoot, MenuTrigger } from "./menu-root";
import { MenuItem } from "./menu-item";
import { useMenuContext, IOS_TEARDOWN_GRACE_MS } from "./menu-context";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { en } from "@/i18n/resources/en";
import { SplitLayoutPicker } from "@/components/split-layout-picker";
import { SPLIT_LAYOUT_PRESETS, type SplitSide } from "@/components/split-layout-presets";

const formFactor = vi.hoisted(() => ({ compact: false }));
vi.mock("@/constants/layout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/constants/layout")>()),
  useIsCompactFormFactor: () => formFactor.compact,
}));
const pickerI18n = createInstance();
beforeAll(async () => {
  await pickerI18n.init({ lng: "en", fallbackLng: "en", resources: { en: { translation: en } } });
});
const originalPlatform = Platform.OS;
afterEach(() => {
  formFactor.compact = false;
  Object.assign(Platform, { OS: originalPlatform });
  vi.useRealTimers();
});
afterEach(cleanup);

beforeEach(() => vi.stubGlobal("React", React));

describe("MenuTrigger", () => {
  it("forwards its rendered trigger to callers", () => {
    const triggerRef = createRef<View>();

    render(
      <MenuRoot>
        <MenuTrigger ref={triggerRef} accessibilityLabel="Open menu">
          <Text>Open</Text>
        </MenuTrigger>
      </MenuRoot>,
    );

    expect(triggerRef.current).not.toBeNull();
  });
});

function MenuOpenState() {
  const { open } = useMenuContext("MenuOpenState");
  return <Text>{open ? "open" : "closed"}</Text>;
}
function CreationRow({ create, split }: { create: () => void; split: () => void }) {
  const secondary = useMemo(
    () => (
      <MenuItem iconOnly accessibilityLabel="Choose split" onSelect={split} closeOnSelect={false} />
    ),
    [split],
  );
  return (
    <MenuItem onSelect={create} secondaryAction={secondary}>
      Create view
    </MenuItem>
  );
}
it("keeps a menu row's split control separate from its primary creation action", () => {
  const create = vi.fn();
  const split = vi.fn();
  const view = render(
    <MenuRoot defaultOpen>
      <CreationRow create={create} split={split} />
      <MenuOpenState />
    </MenuRoot>,
  );
  const primary = view.getByRole("menuitem", { name: "Create view" });
  const secondary = view.getByRole("menuitem", { name: "Choose split" });
  expect(primary.contains(secondary)).toBe(false);
  fireEvent.click(secondary);
  expect(split).toHaveBeenCalledTimes(1);
  expect(create).not.toHaveBeenCalled();
  expect(view.getByText("open")).toBeTruthy();
  fireEvent.click(primary);
  expect(create).toHaveBeenCalledTimes(1);
  expect(view.getByText("closed")).toBeTruthy();
});

function PickerInMenu({
  onSelect,
  disabled = false,
  move = false,
}: {
  onSelect: (side: SplitSide, fraction: number) => void;
  disabled?: boolean;
  move?: boolean;
}) {
  const menu = useMenuContext("PickerInMenu");
  const select = useCallback(
    (side: SplitSide, fraction: number) => {
      menu.selectItem(() => onSelect(side, fraction), true);
    },
    [menu, onSelect],
  );
  const intent = useMemo(
    () => (move ? { kind: "move" as const } : { kind: "open" as const, item: "Terminal" }),
    [move],
  );
  if (!menu.open) return null;
  return (
    <SplitLayoutPicker
      onSelect={select}
      disabled={disabled}
      intent={intent}
      testIDPrefix="region"
    />
  );
}

function renderPicker(
  onSelect: (side: SplitSide, fraction: number) => void,
  options: { disabled?: boolean; move?: boolean } = {},
) {
  return render(
    <I18nextProvider i18n={pickerI18n}>
      <MenuRoot defaultOpen>
        <PickerInMenu onSelect={onSelect} {...options} />
        <MenuOpenState />
      </MenuRoot>
    </I18nextProvider>,
  );
}

const regionCases = SPLIT_LAYOUT_PRESETS.flatMap((preset) =>
  (["left", "right", "top", "bottom"] as const).map((side) => ({
    label: preset.label,
    fraction: preset.fraction,
    side,
  })),
);

describe("literal split regions", () => {
  it.each(regionCases)(
    "selects $side of $label without complementing the API fraction",
    ({ side, label, fraction }) => {
      const select = vi.fn();
      const view = renderPicker(select);
      const region = view.getByTestId(`region-${side}-${label.replace("/", "-")}`);
      const percent = side === "left" || side === "top" ? fraction * 100 : (1 - fraction) * 100;
      expect(region.getAttribute("aria-label")).toBe(
        `Open Terminal: ${en.workspace.splits[side]}, ${Math.round(percent)}%`,
      );
      fireEvent.click(region);
      expect(select).toHaveBeenCalledExactlyOnceWith(side, fraction);
      expect(view.getByText("closed")).toBeTruthy();
      expect(view.queryByTestId("region-left-50-50")).toBeNull();
    },
  );

  it("exposes twenty separate keyboard targets in geometric order, with no side rows", () => {
    const view = renderPicker(vi.fn());
    const regions = view.getAllByRole("menuitem");
    expect(regions).toHaveLength(20);
    const order = ["left", "right", "top", "bottom"] as const;
    const expected: string[] = [];
    for (const sides of [order.slice(0, 2), order.slice(2)]) {
      for (const preset of SPLIT_LAYOUT_PRESETS) {
        for (const side of sides) expected.push(`region-${side}-${preset.label.replace("/", "-")}`);
      }
    }
    expect(regions.map((region) => region.getAttribute("data-testid"))).toEqual(expected);
    for (const region of regions) {
      expect(region.getAttribute("data-menu-item")).toBe("true");
      expect(region.getAttribute("data-menu-disabled")).toBe("false");
      expect(region.tabIndex).toBe(-1);
      act(() => region.focus());
      expect(document.activeElement).toBe(region);
      expect(region.querySelector('[role="menuitem"]')).toBeNull();
    }
    for (const side of order) expect(view.queryByText(en.workspace.splits[side])).toBeNull();
  });

  it("keeps disabled regions out of menu navigation and never dispatches", () => {
    const select = vi.fn();
    const view = renderPicker(select, { disabled: true });
    for (const region of view.getAllByRole("menuitem")) {
      expect(region.getAttribute("data-menu-disabled")).toBe("true");
      fireEvent.click(region);
    }
    expect(select).not.toHaveBeenCalled();
    expect(view.getByText("open")).toBeTruthy();
  });

  it("allocates both compact region axes at least 44px without overlapping hit expansion", () => {
    formFactor.compact = true;
    const view = renderPicker(vi.fn());
    for (const region of view.getAllByRole("menuitem")) {
      const style = getComputedStyle(region);
      expect(Number.parseFloat(style.width)).toBeGreaterThanOrEqual(44);
      expect(Number.parseFloat(style.height)).toBeGreaterThanOrEqual(44);
    }
    const left = view.getByTestId("region-left-70-30");
    const right = view.getByTestId("region-right-70-30");
    expect(left.parentElement).toBe(right.parentElement);
    expect(Number.parseFloat(getComputedStyle(left).width)).toBeCloseTo(103.6);
    expect(Number.parseFloat(getComputedStyle(right).width)).toBeCloseTo(44.4);
    expect(getComputedStyle(left.parentElement!).direction).toBe("ltr");
  });

  it("uses the same region contract and action-specific label when moving", () => {
    const select = vi.fn();
    const view = renderPicker(select, { move: true });
    fireEvent.click(view.getByRole("menuitem", { name: "Move tab: Bottom, 40%" }));
    expect(select).toHaveBeenCalledExactlyOnceWith("bottom", 0.6);
  });

  it("closes before iOS dispatch and retains the action after picker unmount", () => {
    vi.useFakeTimers();
    Object.assign(Platform, { OS: "ios" });
    const select = vi.fn();
    const view = renderPicker(select);
    fireEvent.click(view.getByTestId("region-right-60-40"));
    expect(view.getByText("closed")).toBeTruthy();
    expect(view.queryByTestId("region-right-60-40")).toBeNull();
    expect(select).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(IOS_TEARDOWN_GRACE_MS));
    expect(select).toHaveBeenCalledExactlyOnceWith("right", 0.6);
  });
});
