import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { Dimensions, Pressable, Text, View } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Tooltip, TooltipTrigger } from "./tooltip";
import { SettingsInfoTip } from "@/components/settings/headings/settings-info-tip";
import { SettingsExample } from "@/components/settings/settings-example";

// The shared SVG stub renders null; this local DOM double checks decoration accessibility only.
// Genuine SVG paint and image loading are verified in the isolated browser cases.
vi.mock("react-native-svg", () => {
  const element =
    (name: string) =>
    ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) =>
      React.createElement(name, props, children);
  return {
    default: element("svg"),
    Svg: element("svg"),
    G: element("g"),
    Path: element("path"),
    Circle: element("circle"),
    Rect: element("rect"),
    Line: element("line"),
  };
});

// Unit asset registration stands in for Metro's numeric require; browser QA loads the real PNGs.
vi.mock("react-native-web/dist/modules/AssetRegistry", () => ({
  getAssetByID: () => ({
    width: 60,
    height: 36,
    scales: [1],
    httpServerLocation: "/assets",
    name: "unit-control",
    type: "png",
  }),
}));

vi.mock("@/constants/platform", () => ({
  isWeb: true,
  isNative: false,
}));

const layout = vi.hoisted(() => ({ compact: false }));
vi.mock("@/constants/layout", () => ({
  useIsCompactFormFactor: () => layout.compact,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { title?: string }) => {
      if (key === "settings.groupInfo") return `About ${values?.title}`;
      if (key === "paseoPlusPlus.examples.imageLabel") return `${values?.title} example`;
      return key;
    },
  }),
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

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  layout.compact = false;
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("Node", dom.window.Node);
  vi.stubGlobal("navigator", dom.window.navigator);
  // React Native Web initializes Dimensions before this manually installed JSDOM window.
  Dimensions.set({
    window: { width: 390, height: 844, scale: 1, fontScale: 1 },
    screen: { width: 390, height: 844, scale: 1, fontScale: 1 },
  });

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

const richHelp = (
  <View testID="rich-help">
    <Text>Real image captions will appear here.</Text>
  </View>
);

/** Use actual DOM focus and press events on the existing help trigger. */
function pressSettingsHelp(title = "Example setting") {
  const trigger = Array.from(container?.querySelectorAll("button") ?? []).find(
    (button) => button.getAttribute("aria-label") === `About ${title}`,
  );
  expect(trigger).not.toBeNull();
  act(() => trigger?.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
  return trigger as HTMLButtonElement;
}

describe("SettingsInfoTip", () => {
  it("ignores touch hover boundaries in tap mode and preserves the open example after touch release", () => {
    layout.compact = true;
    act(() => root?.render(<SettingsInfoTip title="Example setting" info={richHelp} />));
    const trigger = container!.querySelector("button")!;
    const touchBoundary = (type: string, relatedTarget: EventTarget | null = null) => {
      const event = new window.MouseEvent(type, { bubbles: true, relatedTarget });
      Object.defineProperty(event, "pointerType", { value: "touch" });
      act(() => trigger.dispatchEvent(event));
    };
    touchBoundary("pointerover");
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    pressSettingsHelp();
    touchBoundary("pointerout", document.body);
    expect(document.querySelector('[data-testid="rich-help"]')).not.toBeNull();
  });

  it("retains desktop pointer hover disclosure and departure dismissal", () => {
    act(() => root?.render(<SettingsInfoTip title="Example setting" info={richHelp} />));
    const trigger = container!.querySelector("button")!;
    act(() => trigger.dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true })));
    expect(document.querySelector('[data-testid="rich-help"]')).not.toBeNull();
    act(() =>
      trigger.dispatchEvent(
        new window.MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }),
      ),
    );
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });

  it("retains accessible text help on compact tap", () => {
    layout.compact = true;
    act(() =>
      root?.render(<SettingsInfoTip title="Example setting" info="Saved data is preserved" />),
    );
    pressSettingsHelp();
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
      "Saved data is preserved",
    );
  });

  it("mounts rich content outside Text and closes when focus leaves", () => {
    layout.compact = true;
    act(() => root?.render(<SettingsInfoTip title="Example setting" info={richHelp} />));
    const trigger = pressSettingsHelp();
    const richBody = document.querySelector('[data-testid="rich-help"]');
    expect(richBody?.parentElement?.getAttribute("role")).toBe("tooltip");
    expect(richBody?.closest("span")).toBeNull();
    const outside = document.createElement("button");
    outside.type = "button";
    document.body.appendChild(outside);
    act(() => {
      trigger.focus();
      outside.focus();
    });
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });

  it("shows text only when no real screenshots are registered", () => {
    layout.compact = true;
    act(() =>
      root?.render(
        <SettingsExample
          title="Example setting"
          caption="Android checks stay available"
          testID="example-help"
        />,
      ),
    );
    pressSettingsHelp();
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
      "Android checks stay available",
    );
    expect(document.querySelector("img")).toBeNull();
  });
  it("keeps a small image at its actual width and gives the example a descriptive accessible label", () => {
    layout.compact = true;
    act(() =>
      root?.render(
        <SettingsExample
          title="Bulk actions"
          caption="Expand and collapse groups"
          testID="image-help"
          images={[
            {
              id: "small-control",
              source: 1,
              width: 60,
              height: 36,
              arrows: [{ fromX: 10, fromY: 32, toX: 20, toY: 18 }],
              outlines: [{ left: 4, top: 4, width: 48, height: 24 }],
            },
          ]}
        />,
      ),
    );
    pressSettingsHelp("Bulk actions");
    const image = document.querySelector("img");
    expect(image).not.toBeNull();
    expect(image?.parentElement?.style.width).toBe("60px");
    const annotation = document.querySelector('svg[viewBox="0 0 60 36"]');
    expect(annotation?.getAttribute("aria-hidden")).toBe("true");
    expect(annotation?.querySelectorAll("rect")).toHaveLength(2);
    expect(image?.getAttribute("alt")).toBe("Bulk actions example. Expand and collapse groups");
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
      "Expand and collapse groups",
    );
  });
  it("frames the contextual region without changing the full screenshot and stays within a narrow screen", () => {
    layout.compact = true;
    Dimensions.set({
      window: { width: 320, height: 640, scale: 1, fontScale: 1 },
      screen: { width: 320, height: 640, scale: 1, fontScale: 1 },
    });
    act(() =>
      root?.render(
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
            },
          ]}
        />,
      ),
    );
    pressSettingsHelp("Project activity");
    const image = document.querySelector("img")!;
    const original = image.parentElement!;
    const frame = original.parentElement!;
    expect(frame.style.width).toBe("272px");
    expect(original.style.width).toBe("1224px");
    expect(original.style.height).toBe("765px");
    expect(original.style.top).toBe("-106.25px");
    expect(document.querySelector("svg")).toBeNull();
    expect(image.getAttribute("alt")).toContain("Status beside its project and workspaces");
  });
});
