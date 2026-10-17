import { TextPreview } from "./text-preview";
import { SettingsExample } from "@/components/settings/settings-example";
import type { ImageProps } from "react-native";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { page, userEvent } from "vitest/browser";
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

// Match the tooltip suite's DOM decoration adapter instead of the shared null SVG stub.
// This verifies vector placement in Chromium; native SVG rendering remains device-only QA.
vi.mock("react-native-svg", () => {
  const element =
    (name: string) =>
    ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) =>
      React.createElement(name, props, children);
  return { default: element("svg"), G: element("g"), Path: element("path"), Rect: element("rect") };
});

// Vite has no Metro numeric-asset registration. Resolve this static fixture ID
// to its genuine local PNG, then use the real Image renderer and layout behavior.
vi.mock("react-native", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native")>();
  const screenshot = { uri: "/assets/settings-examples/project-header.png" };
  return {
    ...actual,
    Image: (props: ImageProps) => (
      <actual.Image {...props} source={props.source === 1 ? screenshot : props.source} />
    ),
  };
});

const TEXT_PREVIEW_TEST_STYLE = { fontSize: 20, lineHeight: 24 };

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

it("measures clamped preview content at exact line boundaries and after resize", async () => {
  const onOverflow = vi.fn();
  container = document.createElement("div");
  Object.assign(container.style, { width: "320px", display: "flex", flexDirection: "column" });
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <TextPreview
        style={TEXT_PREVIEW_TEST_STYLE}
        numberOfLines={2}
        onOverflowChange={onOverflow}
        testID="preview-actual"
      >
        {"First line\nSecond line"}
      </TextPreview>,
    ),
  );
  await expect.poll(() => onOverflow.mock.lastCall?.[0]).toBe(false);
  const actual = container.querySelector('[data-testid="preview-actual"]') as HTMLElement;
  const clip = container.querySelector('[data-testid="text-preview-clip"]') as HTMLElement;
  expect(container.querySelector('[data-testid="text-preview-measurement"]')).toBeNull();
  expect(container.textContent).toBe("First line\nSecond line");
  await expect.poll(() => actual.clientHeight).toBe(48);
  expect(clip.clientHeight).toBe(48);
  act(() =>
    root!.render(
      <TextPreview
        style={TEXT_PREVIEW_TEST_STYLE}
        numberOfLines={1}
        onOverflowChange={onOverflow}
        testID="preview-actual"
      >
        {"First line\nSecond line"}
      </TextPreview>,
    ),
  );
  await expect.poll(() => onOverflow.mock.lastCall?.[0]).toBe(true);
  await expect.poll(() => clip.clientHeight).toBe(24);
  expect(actual.clientHeight).toBe(48);
  expect(container.querySelector('[data-testid="preview-actual"]')).toBe(actual);
  expect(container.textContent).toBe("First line\nSecond line");
  act(() =>
    root!.render(
      <TextPreview
        style={TEXT_PREVIEW_TEST_STYLE}
        numberOfLines={1}
        onOverflowChange={onOverflow}
        testID="preview-actual"
      >
        short
      </TextPreview>,
    ),
  );
  await expect.poll(() => onOverflow.mock.lastCall?.[0]).toBe(false);
  act(() =>
    root!.render(
      <TextPreview
        style={TEXT_PREVIEW_TEST_STYLE}
        numberOfLines={2}
        onOverflowChange={onOverflow}
        testID="preview-actual"
      >
        Boundary wrapping content uses the actual font and width
      </TextPreview>,
    ),
  );
  container.style.width = "140px";
  await expect.poll(() => onOverflow.mock.lastCall?.[0]).toBe(true);
  container.style.display = "none";
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  expect(onOverflow.mock.lastCall?.[0]).toBe(true);
  container.style.width = "900px";
  container.style.display = "flex";
  await expect.poll(() => onOverflow.mock.lastCall?.[0]).toBe(false);
});

it("shows a contextual screenshot with one outline and fits narrow settings help", async () => {
  await page.viewport(390, 844);
  container = document.createElement("div");
  container.style.padding = "24px";
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <SettingsExample
        title="Project activity"
        caption="Status beside its project and workspaces"
        testID="context-help"
        images={[
          {
            id: "project-context",
            source: 1,
            width: 1440,
            height: 900,
            viewport: { left: 0, top: 125, width: 320, height: 270 },
            outlines: [{ left: 226, top: 14, width: 52, height: 28 }],
          },
        ]}
      />,
    ),
  );
  await userEvent.hover(container.querySelector('[data-testid="context-help"]')!);
  const content = page.getByTestId("context-help-content");
  await expect.element(content).toBeVisible();
  const image = document.querySelector("img")!;
  await expect.poll(() => image.complete && image.naturalWidth === 1440).toBe(true);
  expect(image.naturalHeight).toBe(900);
  const frame = image.parentElement!.parentElement!;
  expect(frame.getBoundingClientRect().width).toBe(320);
  expect(frame.getBoundingClientRect().height).toBe(270);
  expect(getComputedStyle(frame).overflow).toBe("hidden");
  expect(frame.querySelectorAll("svg")).toHaveLength(1);
  expect(frame.querySelectorAll("rect")).toHaveLength(2);
  const bounds = content.element().getBoundingClientRect();
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(390);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  expect(window.innerWidth).toBe(390);
  await page.screenshot({ path: ".vitest-screenshots/settings-context-390.png" });
  await page.viewport(320, 640);
  await expect.poll(() => frame.getBoundingClientRect().width).toBe(272);
  const narrowBounds = content.element().getBoundingClientRect();
  expect(narrowBounds.left).toBeGreaterThanOrEqual(0);
  expect(narrowBounds.right).toBeLessThanOrEqual(320);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  expect(window.innerWidth).toBe(320);
  await page.screenshot({ path: ".vitest-screenshots/settings-context-320.png" });
  await page.viewport(1280, 720);
});
