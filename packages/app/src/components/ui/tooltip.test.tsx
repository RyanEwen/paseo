import { HoverCard, HoverCardContent, HoverCardTrigger } from "./hover-card";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { Pressable, Text, View } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Tooltip, TooltipTrigger } from "./tooltip";

vi.mock("@/constants/platform", () => ({
  isWeb: true,
  isNative: false,
}));

vi.mock("@/constants/layout", () => ({
  useIsCompactFormFactor: () => false,
}));

vi.mock("@gorhom/portal", () => ({
  Portal: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@gorhom/bottom-sheet", () => ({
  useBottomSheetModalInternal: () => null,
}));

vi.mock("react-native-reanimated", () => ({
  default: {
    View: "div",
  },
  FadeIn: { duration: () => undefined },
  FadeOut: { duration: () => undefined },
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (styles: unknown) => styles,
  },
}));

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("Node", dom.window.Node);
  vi.stubGlobal("navigator", dom.window.navigator);

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

function renderTrigger({
  childDisabled,
  onPress,
}: {
  childDisabled: boolean;
  onPress: () => void;
}): void {
  act(() => {
    root?.render(
      <Tooltip>
        <TooltipTrigger asChild>
          <Pressable disabled={childDisabled} onPress={onPress} testID="trigger">
            <Text>Send</Text>
          </Pressable>
        </TooltipTrigger>
      </Tooltip>,
    );
  });
}

function pressTrigger(): void {
  const trigger = container?.querySelector('[data-testid="trigger"]');
  expect(trigger).not.toBeNull();

  act(() => {
    trigger?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
}

describe("TooltipTrigger", () => {
  it("keeps an asChild trigger disabled when the child is disabled", () => {
    const onPress = vi.fn();

    renderTrigger({ childDisabled: true, onPress });
    pressTrigger();

    expect(onPress).not.toHaveBeenCalled();
  });

  it("keeps an asChild trigger interactive when the child is not disabled", () => {
    const onPress = vi.fn();

    renderTrigger({ childDisabled: false, onPress });
    pressTrigger();

    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

let hoverDetailRenders = 0;
function DelayedHoverDetails() {
  hoverDetailRenders++;
  return <Text testID="delayed-hover-details">Workspace details</Text>;
}
function renderDelayedHover(disabled = false): void {
  act(() =>
    root?.render(
      <HoverCard openDelay={250} disabled={disabled}>
        <HoverCardTrigger focusable accessibilityLabel="Workspace hover trigger">
          <View testID="delayed-hover-trigger">
            <Text>Workspace</Text>
          </View>
        </HoverCardTrigger>
        <HoverCardContent placement="right">
          <DelayedHoverDetails />
        </HoverCardContent>
      </HoverCard>,
    ),
  );
}
function hoverBoundary(type: "pointerover" | "pointerout"): void {
  const trigger = container!.querySelector('[data-testid="delayed-hover-trigger"]')!;
  act(() =>
    trigger.dispatchEvent(
      new window.MouseEvent(type, {
        bubbles: true,
        relatedTarget: document.body,
      }),
    ),
  );
}

describe("workspace hover dwell", () => {
  beforeEach(() => {
    hoverDetailRenders = 0;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not render detail content until the pointer dwells for 250ms", async () => {
    renderDelayedHover();
    hoverBoundary("pointerover");
    act(() => vi.advanceTimersByTime(249));
    expect(hoverDetailRenders).toBe(0);
    expect(document.querySelector('[data-testid="delayed-hover-details"]')).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(hoverDetailRenders).toBe(1);
    expect(document.querySelector('[data-testid="delayed-hover-details"]')).not.toBeNull();
  });

  it.each(["leave", "disable", "unmount", "scroll", "resize", "escape"] as const)(
    "cancels pending detail rendering on %s",
    (reason) => {
      renderDelayedHover();
      hoverBoundary("pointerover");
      act(() => vi.advanceTimersByTime(100));
      if (reason === "leave") hoverBoundary("pointerout");
      else if (reason === "disable") renderDelayedHover(true);
      else if (reason === "unmount") act(() => root?.render(null));
      else if (reason === "escape") {
        const beforeFocus = document.activeElement;
        const event = new window.KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        });
        act(() => document.body.dispatchEvent(event));
        expect(event.defaultPrevented).toBe(false);
        expect(document.activeElement).toBe(beforeFocus);
      } else
        act(() => {
          (reason === "scroll" ? document : window).dispatchEvent(new window.Event(reason));
        });
      act(() => vi.advanceTimersByTime(500));
      expect(hoverDetailRenders).toBe(0);
      expect(document.querySelector('[data-testid="delayed-hover-details"]')).toBeNull();
    },
  );

  it("keeps keyboard focus disclosure immediate", async () => {
    renderDelayedHover();
    const trigger = container!.querySelector<HTMLElement>(
      '[aria-label="Workspace hover trigger"]',
    )!;
    await act(async () => {
      trigger.focus();
    });
    expect(hoverDetailRenders).toBe(1);
  });
});
