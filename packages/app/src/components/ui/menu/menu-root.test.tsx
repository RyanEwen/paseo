/**
 * @vitest-environment jsdom
 */
import React, { createRef, useMemo } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { Text, type View } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MenuRoot, MenuTrigger } from "./menu-root";
import { MenuItem } from "./menu-item";
import { useMenuContext } from "./menu-context";
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
