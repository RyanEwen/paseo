import React, { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { userEvent } from "vitest/browser";
import { i18n } from "@/i18n/i18next";
import { ActualPromptTestFixture, ACTUAL_PROMPT_ID } from "./actual-prompt-test-fixture";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createFindViewport } from "./viewport.web";
import type { ChatFindProps } from "./types";
import type { StreamViewportHandle } from "../strategy";

interface Capture {
  occurrence?: { signal: AbortSignal; targetTop(): number | null };
}

function transcript(messageId: string, blocks: string[]): HTMLElement {
  const root = document.createElement("div");
  for (const [index, text] of blocks.entries()) {
    const row = document.createElement("div");
    row.setAttribute("data-history-row-id", `${messageId}:block:${index}`);
    row.setAttribute("data-message-id", messageId);
    row.innerHTML = `<div data-message-text="true"><div data-paseo-markdown-tag="p">${text}</div></div>`;
    root.append(row);
  }
  document.body.append(root);
  return root;
}

function viewport(root: HTMLElement, capture: Capture) {
  const handle: StreamViewportHandle = {
    scrollToBottom() {},
    prepareForViewportChange() {},
    scrollToMessage(_messageId, occurrence) {
      if (occurrence) capture.occurrence = occurrence;
    },
  };
  const bindings: Pick<ChatFindProps, "viewportRef" | "revealLoadedMessage" | "visibleMessageIds"> =
    {
      viewportRef: { current: handle },
      revealLoadedMessage: () => false,
      visibleMessageIds: new Set(["message-1"]),
    };
  return createFindViewport({
    getBindings: () => bindings,
    getRoot: () => root,
    highlightName: "paseo-chat-find-test",
  });
}

afterEach(() => {
  CSS.highlights.delete("paseo-chat-find-test");
  document.body.replaceChildren();
});

it("counts occurrences across every block row of the message", async () => {
  const root = transcript("message-1", ["needle one needle", "no hits", "needle three"]);
  const capture: Capture = {};
  const found = await viewport(root, capture).reveal(
    "message-1",
    "needle",
    2,
    new AbortController().signal,
  );
  expect(found).toEqual({ occurrence: 2, count: 3 });
});

// The settle loop asks for the target position every frame while the viewport moves,
// and rows mount and unmount as it does. A flat index into the message would name a
// different occurrence each time the row set changed; the chosen row owns it instead.
it("keeps the chosen occurrence when an earlier row unmounts mid-scroll", async () => {
  const root = transcript("message-1", ["needle one needle", "needle three"]);
  const capture: Capture = {};
  const found = await viewport(root, capture).reveal(
    "message-1",
    "needle",
    2,
    new AbortController().signal,
  );
  expect(found).toEqual({ occurrence: 2, count: 3 });

  const settled = capture.occurrence?.targetTop();
  expect(settled).toBeTypeOf("number");
  expect(highlightedText()).toEqual(["needle"]);
  expect(highlightedRow()).toBe("message-1:block:1");

  root.firstElementChild?.remove();
  expect(capture.occurrence?.targetTop()).toBeTypeOf("number");
  expect(highlightedRow()).toBe("message-1:block:1");
});

function highlightedRanges(): Range[] {
  const highlight = CSS.highlights.get("paseo-chat-find-test");
  return highlight ? Array.from(highlight).filter((range) => range instanceof Range) : [];
}

function highlightedText(): string[] {
  return highlightedRanges().map((range) => range.toString());
}

function highlightedRow(): string | undefined {
  const row =
    highlightedRanges()[0]?.startContainer.parentElement?.closest<HTMLElement>(
      "[data-history-row-id]",
    );
  return row?.dataset.historyRowId;
}

let actualRoot: Root | null = null;
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(() => {
  act(() => actualRoot?.unmount());
  actualRoot = null;
  vi.unstubAllGlobals();
});

function actualPrompt(text: string) {
  void i18n;
  const host = document.createElement("div");
  Object.assign(host.style, { width: "300px", height: "320px" });
  document.body.append(host);
  const ref = createRef<StreamViewportHandle>();
  actualRoot = createRoot(host);
  function render(enabled = true, nextText = text) {
    act(() =>
      actualRoot!.render(
        React.createElement(ActualPromptTestFixture, { text: nextText, enabled, viewportRef: ref }),
      ),
    );
  }
  render();
  return { host, ref, render };
}

function actualPromptGeometry(host: HTMLElement) {
  const scrollElement = host.querySelector<HTMLElement>('[data-testid="agent-chat-scroll"]')!;
  const row = host.querySelector<HTMLElement>(`[data-history-row-id="${ACTUAL_PROMPT_ID}"]`)!;
  const bubble = row.querySelector<HTMLElement>('[data-testid="user-message-bubble"]')!;
  return {
    viewport: scrollElement.getBoundingClientRect().toJSON(),
    originalWrapper: row.getBoundingClientRect().toJSON(),
    bubble: bubble.getBoundingClientRect().toJSON(),
    scrollTop: scrollElement.scrollTop,
    clientHeight: scrollElement.clientHeight,
    scrollHeight: scrollElement.scrollHeight,
    pinned: row.dataset.promptPinned,
    translation: row.dataset.promptTranslation,
  };
}

function exactTextNodes(root: HTMLElement, text: string): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode()))
    if (node instanceof Text && node.data === text) nodes.push(node);
  return nodes;
}

it("keeps one actual prompt text node through pin, More/Less and settings off/on", async () => {
  const prompt = "First prompt line\nSecond prompt line\nThird prompt line";
  const fixture = actualPrompt(prompt);
  const text = fixture.host.querySelector<HTMLElement>('[data-testid="user-message-text"]')!;
  const node = exactTextNodes(fixture.host, prompt)[0];
  await expect
    .poll(() => fixture.host.querySelector('[data-testid="user-message-disclosure"]'))
    .not.toBeNull();
  expect(exactTextNodes(fixture.host, prompt)).toHaveLength(1);
  expect(fixture.host.querySelector('[data-testid="text-preview-measurement"]')).toBeNull();
  const clip = text.closest<HTMLElement>('[data-testid="text-preview-clip"]')!;
  const lineHeight = Number.parseFloat(getComputedStyle(text).lineHeight);
  expect(clip.getBoundingClientRect().height).toBe(lineHeight);
  await userEvent.click(
    fixture.host.querySelector<HTMLElement>('[data-testid="user-message-disclosure"]')!,
  );
  await expect
    .poll(() => clip.getBoundingClientRect().height)
    .toBe(text.getBoundingClientRect().height);
  const beforeJump = actualPromptGeometry(fixture.host);
  console.info("actual-prompt-before-jump", JSON.stringify(beforeJump));
  expect(beforeJump.clientHeight).toBe(320);
  expect(beforeJump.scrollHeight).toBeGreaterThan(beforeJump.clientHeight);
  try {
    act(() => fixture.ref.current!.scrollToMessage!(ACTUAL_PROMPT_ID, undefined, "pinned"));
    await expect
      .poll(() => fixture.host.querySelector('[data-prompt-pinned="true"]'))
      .not.toBeNull();
  } catch (error) {
    console.info("actual-prompt-jump-failure", JSON.stringify(actualPromptGeometry(fixture.host)));
    throw error;
  }
  expect(fixture.host.querySelector('[data-testid="user-message-text"]')).toBe(text);
  expect(exactTextNodes(fixture.host, prompt)).toEqual([node]);
  await userEvent.click(
    fixture.host.querySelector<HTMLElement>('[data-testid="user-message-disclosure"]')!,
  );
  await expect.poll(() => clip.getBoundingClientRect().height).toBe(lineHeight);
  fixture.render(false);
  await expect
    .poll(() => clip.getBoundingClientRect().height)
    .toBe(text.getBoundingClientRect().height);
  expect(exactTextNodes(fixture.host, prompt)).toEqual([node]);
  fixture.render(true);
  await expect.poll(() => clip.getBoundingClientRect().height).toBe(lineHeight);
  expect(exactTextNodes(fixture.host, prompt)).toEqual([node]);
  expect(fixture.host.querySelector('[data-testid="user-message-text"]')).toBe(text);
});

it("updates actual prompt More availability from wrapping at the real width", async () => {
  const prompt = "A prompt that fits one wide line but wraps at a narrow width";
  const fixture = actualPrompt(prompt);
  fixture.host.style.width = "1000px";
  await expect
    .poll(() => fixture.host.querySelector('[data-testid="user-message-disclosure"]'))
    .toBeNull();
  const text = fixture.host.querySelector('[data-testid="user-message-text"]');
  fixture.host.style.width = "160px";
  await expect
    .poll(() => fixture.host.querySelector('[data-testid="user-message-disclosure"]'))
    .not.toBeNull();
  expect(fixture.host.querySelector('[data-testid="user-message-text"]')).toBe(text);
  expect(exactTextNodes(fixture.host, prompt)).toHaveLength(1);
  fixture.render(true, "Short");
  await expect
    .poll(() => fixture.host.querySelector('[data-testid="user-message-disclosure"]'))
    .toBeNull();
  expect(fixture.host.querySelector('[data-testid="user-message-text"]')).toBe(text);
  expect(exactTextNodes(fixture.host, "Short")).toHaveLength(1);
});

it("reveals a deep actual user match inside its body then its original row, and fences stale inner writes", async () => {
  const prompt =
    Array.from({ length: 80 }, (_, index) => `Line ${index}`).join("\n") + "\nneedle tail";
  const fixture = actualPrompt(prompt);
  const text = fixture.host.querySelector<HTMLElement>('[data-testid="user-message-text"]')!;
  await expect
    .poll(() => fixture.host.querySelector('[data-testid="user-message-disclosure"]'))
    .not.toBeNull();
  const body = fixture.host.querySelector<HTMLElement>('[data-testid="user-message-body-scroll"]')!;
  expect(body.dataset.bodyExpanded).toBe("false");
  expect(body.contains(fixture.host.querySelector('[data-testid="user-message-disclosure"]'))).toBe(
    false,
  );
  expect(body.contains(fixture.host.querySelector('[data-testid="user-message-next"]'))).toBe(
    false,
  );
  act(() => fixture.ref.current!.scrollToMessage!(ACTUAL_PROMPT_ID, undefined, "pinned"));
  await expect.poll(() => fixture.host.querySelector('[data-prompt-pinned="true"]')).not.toBeNull();
  const handle = fixture.ref.current!;
  const originalScroll = handle.scrollToMessage!;
  const operations: NonNullable<Capture["occurrence"]>[] = [];
  handle.scrollToMessage = (id, occurrence, placement) => {
    if (occurrence) operations.push(occurrence);
    originalScroll(id, occurrence, placement);
  };
  const find = createFindViewport({
    getBindings: () => ({
      viewportRef: fixture.ref,
      revealLoadedMessage: () => true,
      visibleMessageIds: new Set([ACTUAL_PROMPT_ID]),
    }),
    getRoot: () => fixture.host,
    highlightName: "paseo-chat-find-test",
  });
  const first = new AbortController();
  await find.reveal(ACTUAL_PROMPT_ID, "needle tail", 0, first.signal);
  await expect.poll(() => body.dataset.bodyExpanded).toBe("true");
  await expect.poll(() => body.scrollHeight > body.clientHeight).toBe(true);
  await expect.poll(() => body.scrollTop > 0).toBe(true);
  await expect
    .poll(() => {
      const range = highlightedRanges()[0]?.getBoundingClientRect();
      const inner = body.getBoundingClientRect();
      const outer = fixture.host
        .querySelector('[data-testid="agent-chat-scroll"]')!
        .getBoundingClientRect();
      return (
        !!range &&
        range.top >= Math.max(inner.top, outer.top) &&
        range.bottom <= Math.min(inner.bottom, outer.bottom)
      );
    })
    .toBe(true);
  expect(fixture.host.querySelector('[data-testid="user-message-text"]')).toBe(text);
  expect(exactTextNodes(fixture.host, prompt)).toHaveLength(1);
  const stale = operations[0]!;
  const deepOffset = body.scrollTop;
  await userEvent.click(
    fixture.host.querySelector<HTMLElement>('[data-testid="user-message-disclosure"]')!,
  );
  await expect.poll(() => body.dataset.bodyExpanded).toBe("false");
  const aborted = new AbortController();
  aborted.abort();
  await expect(find.reveal(ACTUAL_PROMPT_ID, "Line 0", 0, aborted.signal)).rejects.toThrow(
    "Search cancelled",
  );
  expect(body.dataset.bodyExpanded).toBe("false");
  const superseded = new AbortController();
  const supersededReveal = find.reveal(ACTUAL_PROMPT_ID, "needle tail", 0, superseded.signal);
  find.clear();
  await expect(supersededReveal).rejects.toThrow("Search cancelled");
  expect(body.dataset.bodyExpanded).toBe("false");
  const second = new AbortController();
  await find.reveal(ACTUAL_PROMPT_ID, "Line 0", 0, second.signal);
  await expect.poll(() => body.dataset.bodyExpanded).toBe("true");
  await expect.poll(() => body.scrollTop < deepOffset).toBe(true);
  await expect.poll(highlightedText).toEqual(["Line 0"]);
  const firstMatch = highlightedRanges()[0]!.getBoundingClientRect();
  const bodyBounds = body.getBoundingClientRect();
  expect(firstMatch.top).toBeGreaterThanOrEqual(bodyBounds.top);
  expect(firstMatch.bottom).toBeLessThanOrEqual(bodyBounds.bottom);
  const innerBefore = body.scrollTop;
  const outer = fixture.host.querySelector<HTMLElement>('[data-testid="agent-chat-scroll"]')!;
  const outerBefore = outer.scrollTop;
  expect(stale.targetTop()).toBeNull();
  expect(body.scrollTop).toBe(innerBefore);
  expect(outer.scrollTop).toBe(outerBefore);
  first.abort();
  second.abort();
  const latest = operations.at(-1)!;
  expect(latest.targetTop()).toBeNull();
  expect(body.scrollTop).toBe(innerBefore);
  expect(outer.scrollTop).toBe(outerBefore);
});
