// @vitest-environment jsdom

import { useTextOverflow } from "./use-text-overflow";

import { act, renderHook } from "@testing-library/react";
import type { LayoutChangeEvent, TextLayoutEvent } from "react-native";
import { describe, expect, it, vi } from "vitest";
import { readMeasuredWidth, useContainerWidthBelow } from "./use-container-width";

function layoutEvent(width: number, height = 48): LayoutChangeEvent {
  return {
    nativeEvent: {
      layout: {
        width,
        height,
        x: 0,
        y: 0,
      },
    },
  } as LayoutChangeEvent;
}

describe("readMeasuredWidth", () => {
  it("returns the width of a rendered container", () => {
    expect(readMeasuredWidth(layoutEvent(650))).toBe(650);
  });

  it("returns null for the zero width a hidden retained panel reports", () => {
    expect(readMeasuredWidth(layoutEvent(0))).toBeNull();
  });
});

describe("useContainerWidthBelow", () => {
  it("does not re-render for width changes that stay in the same threshold bucket", () => {
    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount += 1;
      return useContainerWidthBelow(700);
    });

    expect(result.current.isBelow).toBe(true);
    expect(renderCount).toBe(1);

    act(() => {
      result.current.onLayout(layoutEvent(650));
      result.current.onLayout(layoutEvent(620));
      result.current.onLayout(layoutEvent(699));
    });

    expect(result.current.isBelow).toBe(true);
    expect(renderCount).toBe(1);
  });

  it("re-renders when the width crosses the threshold", () => {
    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount += 1;
      return useContainerWidthBelow(700);
    });

    act(() => {
      result.current.onLayout(layoutEvent(760));
    });

    expect(result.current.isBelow).toBe(false);
    expect(renderCount).toBe(2);
  });

  it("ignores zero-width measurements from hidden mounted content", () => {
    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount += 1;
      return useContainerWidthBelow(700, { initialIsBelow: false });
    });

    expect(result.current.isBelow).toBe(false);

    act(() => {
      result.current.onLayout(layoutEvent(0));
    });

    expect(result.current.isBelow).toBe(false);
    expect(renderCount).toBe(1);

    act(() => {
      result.current.onLayout(layoutEvent(650));
    });

    expect(result.current.isBelow).toBe(true);
    expect(renderCount).toBe(2);
  });
});

vi.mock("@/constants/platform", () => ({ isWeb: false }));

/** Supply actual native line-layout output, independently of text length. */
function textLines(count: number): TextLayoutEvent {
  return {
    nativeEvent: {
      lines: Array.from({ length: count }, () => ({ width: 100, text: "rendered line" })),
    },
  } as TextLayoutEvent;
}

describe("native clamped text overflow", () => {
  it("does not disclose a short line, and detects actual wrapped lines", () => {
    const { result } = renderHook(() => useTextOverflow("measured content", 1));
    act(() => {
      result.current.onLayout(layoutEvent(240));
      result.current.onFullLayout?.(layoutEvent(240));
      result.current.onFullTextLayout(textLines(1));
    });
    expect(result.current.overflowing).toBe(false);
    act(() => {
      result.current.onFullLayout?.(layoutEvent(240, 96));
      result.current.onFullTextLayout(textLines(2));
    });
    expect(result.current.overflowing).toBe(true);
    act(() => {
      result.current.onFullLayout?.(layoutEvent(240));
      result.current.onFullTextLayout(textLines(1));
    });
    expect(result.current.overflowing).toBe(false);
  });
  it("fits the exact desktop boundary and updates when its line policy changes", () => {
    const { result, rerender } = renderHook(({ lines }) => useTextOverflow("same content", lines), {
      initialProps: { lines: 2 },
    });
    act(() => {
      result.current.onLayout(layoutEvent(180));
      result.current.onFullLayout?.(layoutEvent(180));
      result.current.onFullTextLayout(textLines(2));
    });
    expect(result.current.overflowing).toBe(false);
    rerender({ lines: 1 });
    act(() => result.current.onLayout(layoutEvent(180, 24)));
    expect(result.current.overflowing).toBe(true);
  });
  it("accepts full text layout arriving before visible layout", () => {
    const { result } = renderHook(() => useTextOverflow("full layout first", 1));
    act(() => {
      result.current.onFullLayout?.(layoutEvent(160, 144));
      result.current.onFullTextLayout(textLines(3));
    });
    expect(result.current.overflowing).toBe(false);
    act(() => result.current.onLayout(layoutEvent(160)));
    expect(result.current.overflowing).toBe(true);
  });
  it("preserves the last valid state while a retained pane has zero geometry", () => {
    const { result } = renderHook(() => useTextOverflow("retained prompt", 1));
    act(() => {
      result.current.onLayout(layoutEvent(160));
      result.current.onFullLayout?.(layoutEvent(160, 144));
      result.current.onFullTextLayout(textLines(3));
    });
    expect(result.current.overflowing).toBe(true);
    act(() => {
      result.current.onLayout(layoutEvent(0));
      result.current.onFullLayout?.(layoutEvent(0));
      result.current.onFullTextLayout(textLines(1));
    });
    expect(result.current.overflowing).toBe(true);
    act(() => {
      result.current.onLayout(layoutEvent(500));
      result.current.onFullLayout?.(layoutEvent(500));
    });
    expect(result.current.overflowing).toBe(false);
  });
  it("does not disclose a fitting message when native line reporting wraps it again", () => {
    const { result } = renderHook(() => useTextOverflow("I have WSL set to keep running", 1));
    act(() => {
      result.current.onLayout(layoutEvent(240, 24));
      // Native event handlers are optional on Text; the old probe had no layout handler.
      result.current.onFullLayout?.(layoutEvent(240, 24));
      result.current.onFullTextLayout(textLines(2));
    });
    expect(result.current.overflowing).toBe(false);
  });
});
