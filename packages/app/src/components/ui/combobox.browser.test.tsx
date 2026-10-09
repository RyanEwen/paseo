import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { userEvent } from "vitest/browser";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ComboboxItem } from "./combobox";

// Transition animations are outside this tooltip geometry and interaction regression.
vi.mock("react-native-reanimated", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native-reanimated")>();
  return {
    ...actual,
    FadeIn: { duration: () => undefined },
    FadeOut: { duration: () => undefined },
  };
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

it("reveals truncated dropdown values, updates on resize, and preserves selection", async () => {
  const label = "feature/a-long-branch-name · /home/ryan/projects/a-long-worktree-path";
  const onPress = vi.fn();
  container = document.createElement("div");
  container.style.width = "160px";
  container.style.display = "flex";
  container.style.flexDirection = "column";
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(<ComboboxItem label={label} onPress={onPress} />));
  const row = container.querySelector('[role="button"]') as HTMLElement;

  await expect
    .poll(() => {
      const text = row.querySelector('[dir="auto"]') as HTMLElement;
      return text.scrollWidth > text.clientWidth;
    })
    .toBe(true);
  await act(async () => {
    await userEvent.hover(row);
  });
  await expect.poll(() => document.querySelector('[role="tooltip"]')?.textContent).toBe(label);
  await act(async () => {
    await userEvent.click(row);
  });
  expect(onPress).toHaveBeenCalledTimes(1);

  await userEvent.hover(document.body, { position: { x: 1000, y: 500 } });
  container.style.width = "1000px";
  await expect
    .poll(() => {
      const text = row.querySelector('[dir="auto"]') as HTMLElement;
      return text.scrollWidth <= text.clientWidth;
    })
    .toBe(true);
  await act(async () => {
    await userEvent.hover(row);
  });
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
});
