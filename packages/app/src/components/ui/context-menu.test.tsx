/** @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContextMenuTrigger } from "./context-menu";

const captured = vi.hoisted(() => ({
  style: undefined as unknown,
  setAnchorRect: vi.fn(),
  setOpen: vi.fn(),
  triggerRef: { current: null as unknown },
}));

vi.mock("react-native", () => ({
  Platform: { OS: "web" },
  StatusBar: {},
}));

vi.mock("@/constants/platform", () => ({
  isNative: false,
  isWeb: true,
}));

vi.mock("@/components/ui/menu", () => ({
  MenuHint: () => null,
  MenuItem: () => null,
  MenuLabel: () => null,
  MenuRoot: () => null,
  MenuSeparator: () => null,
  MenuSurface: () => null,
  useMenuContext: () => ({
    open: false,
    setAnchorRect: captured.setAnchorRect,
    setOpen: captured.setOpen,
    triggerRef: captured.triggerRef,
  }),
}));

vi.mock("@/components/ui/press-highlight", () => ({
  PressHighlight: (props: { style?: unknown }) => {
    captured.style = props.style;
    return null;
  },
}));

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.clearAllMocks();
  captured.triggerRef.current = null;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ContextMenuTrigger", () => {
  it("preserves a static trigger style so the native press highlight can inherit its corners", () => {
    vi.stubGlobal("React", React);
    const rowStyle = [{ borderRadius: 8 }, { backgroundColor: "#111" }];

    renderToStaticMarkup(<ContextMenuTrigger style={rowStyle} />);

    expect(captured.style).toBe(rowStyle);
  });

  it("keeps inline prose and the original anchor while using the canonical point and focus ref", () => {
    const onClick = vi.fn((event: React.MouseEvent<HTMLAnchorElement>) => event.preventDefault());
    const { container, getByRole, unmount } = render(
      <p>
        Before
        <ContextMenuTrigger contextOnly inline>
          <a href="https://example.invalid/guide" onClick={onClick} title="Authored title">
            <code>Guide</code>
          </a>
        </ContextMenuTrigger>
        After
      </p>,
    );
    const anchor = getByRole("link");
    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(container.querySelector("p div")).toBeNull();
    expect(container.querySelector("p")?.textContent).toBe("BeforeGuideAfter");
    expect(anchor.getAttribute("title")).toBe("Authored title");
    expect(captured.triggerRef.current).toBe(anchor);

    fireEvent.click(anchor);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(captured.setOpen).not.toHaveBeenCalled();
    expect(fireEvent.contextMenu(anchor, { clientX: 48, clientY: 72, button: 2 })).toBe(false);
    expect(captured.setAnchorRect).toHaveBeenCalledWith({ x: 48, y: 72, width: 0, height: 0 });
    expect(captured.setOpen).toHaveBeenCalledWith(true);
    expect(getByRole("link")).toBe(anchor);
    if (captured.triggerRef.current instanceof HTMLElement) captured.triggerRef.current.focus();
    expect(document.activeElement).toBe(anchor);
    unmount();
    expect(captured.triggerRef.current).toBeNull();
  });

  it("does not open a disabled inline context menu", () => {
    const { getByRole } = render(
      <ContextMenuTrigger contextOnly inline disabled>
        <a href="https://example.invalid/guide">Guide</a>
      </ContextMenuTrigger>,
    );
    fireEvent.contextMenu(getByRole("link"), { clientX: 48, clientY: 72, button: 2 });
    expect(captured.setAnchorRect).not.toHaveBeenCalled();
    expect(captured.setOpen).not.toHaveBeenCalled();
  });
});
