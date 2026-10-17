import type { Locator, TestInfo } from "@playwright/test";
import { expect } from "../fixtures";

/** Measure the padded content cell, not the optional disclosure, as the single-line rail. */
export async function expectSingleLineStickyGeometry(sticky: Locator) {
  const geometry = await sticky.evaluate((node) => {
    const bubble = node.querySelector('[data-testid="user-message-bubble"]')!;
    const controls = node.querySelector('[data-testid="sticky-user-message-controls"]')!;
    const measurement = node.querySelector('[data-testid="text-preview-measurement"]');
    const text = measurement?.parentElement?.parentElement?.firstElementChild;
    const bounds = bubble.getBoundingClientRect();
    let cell = text?.parentElement;
    while (cell && cell !== bubble && Number.parseFloat(getComputedStyle(cell).paddingTop) === 0) {
      cell = cell.parentElement;
    }
    const padding = cell && cell !== bubble ? getComputedStyle(cell) : null;
    const textStyle = text ? getComputedStyle(text) : null;
    const action = node.querySelector('[data-testid="sticky-user-message-disclosure"]');
    const touchParent = action?.parentElement?.getBoundingClientRect();
    return {
      height: bounds.height,
      controlsOffset: controls.getBoundingClientRect().top - bounds.top,
      textHeight: text?.getBoundingClientRect().height ?? null,
      lineHeight: textStyle ? Number.parseFloat(textStyle.lineHeight) : null,
      expectedHeight:
        padding && textStyle
          ? Number.parseFloat(textStyle.lineHeight) +
            Number.parseFloat(padding.paddingTop) +
            Number.parseFloat(padding.paddingBottom)
          : null,
      touch: touchParent
        ? {
            height: touchParent.height,
            top: touchParent.top - bounds.top,
            bottom: touchParent.bottom - bounds.bottom,
          }
        : null,
    };
  });
  expect(geometry.lineHeight).not.toBeNull();
  expect(geometry.expectedHeight).not.toBeNull();
  expect(geometry.height).toBeCloseTo(geometry.expectedHeight!, 0);
  expect(geometry.textHeight!).toBeLessThanOrEqual(geometry.lineHeight! + 0.5);
  if (geometry.touch) {
    expect(geometry.touch.height).toBeGreaterThanOrEqual(44);
    expect(geometry.touch.top).toBeGreaterThanOrEqual(0);
    expect(geometry.touch.bottom).toBeLessThanOrEqual(0);
  }
  return geometry;
}

/** Record usable allocation and painted prompt prefix, including attachment-only copies. */
export async function expectInlineStickyAttachmentCount(
  sticky: Locator,
  count: string,
  prompt: string,
  testInfo: TestInfo,
) {
  const summary = sticky.getByText(count, { exact: true });
  await expect(summary).toBeVisible();
  const geometry = await measureInlineAttachmentAllocation(sticky, count, prompt);
  const label = prompt ? "text-and-attachments" : "attachment-only";
  await testInfo.attach(`compact-allocation-${label}`, {
    body: JSON.stringify(geometry, null, 2),
    contentType: "application/json",
  });
  await sticky.getByTestId("user-message-bubble").screenshot({
    path: testInfo.outputPath(`compact-allocation-${label}.png`),
    timeout: 2_000,
  });
  expect(geometry.count!.bounds.width).toBeGreaterThan(0);
  if (!prompt) {
    expect(geometry.text).toBeNull();
    // A truncated count can use the whole cell instead of reserving an empty text half.
    if (geometry.count!.scrollWidth > geometry.count!.clientWidth) {
      expect(geometry.count!.bounds.width).toBeCloseTo(geometry.cell!.bounds.width, 0);
    }
    return;
  }
  expect(geometry.text!.textContent).toBe(prompt);
  expect(geometry.text!.bounds.width).toBeGreaterThan(0);
  expect(geometry.prefixBounds!.width).toBeGreaterThan(0);
  expect(geometry.prefixBounds!.left).toBeGreaterThanOrEqual(geometry.text!.bounds.left);
  expect(geometry.prefixBounds!.top).toBeGreaterThanOrEqual(geometry.text!.bounds.top);
  expect(geometry.prefixBounds!.bottom).toBeLessThanOrEqual(geometry.text!.bounds.bottom);
  expect(geometry.count!.bounds.x + geometry.count!.bounds.width).toBeLessThanOrEqual(
    geometry.text!.bounds.x,
  );
  expect(
    Math.abs(
      geometry.count!.bounds.y +
        geometry.count!.bounds.height / 2 -
        geometry.text!.bounds.y -
        geometry.text!.bounds.height / 2,
    ),
  ).toBeLessThanOrEqual(1);
  expect(geometry.prefixBounds!.right).toBeLessThanOrEqual(geometry.text!.bounds.right);
  const prefixInk = await countPaintedPromptPrefix(sticky, geometry.prefixBounds!);
  await testInfo.attach("compact-prompt-prefix-ink", {
    body: JSON.stringify({ prefix: geometry.prefix, ink: prefixInk }),
    contentType: "application/json",
  });
  expect(prefixInk).toBeGreaterThan(0);
}

/** Snapshot actual compact allocation before any assertions can end the case. */
async function measureInlineAttachmentAllocation(
  sticky: Locator,
  countLabel: string,
  promptText: string,
) {
  return await sticky.evaluate(
    (node, { count, prompt }) => {
      function rectangle(bounds: DOMRect) {
        const { x, y, width, height, top, right, bottom, left } = bounds;
        return { x, y, width, height, top, right, bottom, left };
      }
      function describe(element: Element | null) {
        if (!element) return null;
        const style = getComputedStyle(element);
        return {
          bounds: rectangle(element.getBoundingClientRect()),
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          textContent: element.textContent,
          overflow: style.overflow,
          whiteSpace: style.whiteSpace,
          lineClamp: style.webkitLineClamp,
        };
      }
      const countNode = Array.from(node.querySelectorAll('[role="link"]')).find(
        (element) => element.textContent === count,
      )!;
      const text = node.querySelector("[data-message-text=true]");
      const prefix = Array.from(prompt)[0] ?? "";
      let prefixBounds: ReturnType<typeof rectangle> | null = null;
      if (text && prefix) {
        const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
        const first = walker.nextNode()!;
        const range = document.createRange();
        range.setStart(first, 0);
        range.setEnd(first, prefix.length);
        prefixBounds = rectangle(range.getBoundingClientRect());
      }
      const disclosure = node.querySelector('[data-testid="sticky-user-message-disclosure"]');
      return {
        bubble: describe(node.querySelector('[data-testid="user-message-bubble"]')),
        count: describe(countNode),
        cell: describe(countNode.parentElement),
        text: describe(text),
        disclosure: describe(disclosure),
        touchParent: describe(disclosure?.parentElement ?? null),
        prefix,
        prefixBounds,
      };
    },
    { count: countLabel, prompt: promptText },
  );
}

/** Count foreground in the first character's painted region, rather than trusting DOM text. */
async function countPaintedPromptPrefix(
  sticky: Locator,
  prefixRectangle: { left: number; right: number },
) {
  const text = sticky.locator("[data-message-text=true]");
  const pixels = await text.screenshot({ timeout: 2_000 });
  return await text.evaluate(
    async (element, { base64, prefixBounds }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, image.width, image.height).data;
      const foreground = getComputedStyle(element).color.match(/\d+/g)!.slice(0, 3).map(Number);
      const foregroundBrightness = foreground.reduce((sum, value) => sum + value, 0) / 3;
      const backgroundBrightness = (data[0]! + data[1]! + data[2]!) / 3;
      const threshold = foregroundBrightness + (backgroundBrightness - foregroundBrightness) * 0.35;
      const textBounds = element.getBoundingClientRect();
      const left = Math.max(0, Math.floor(prefixBounds.left - textBounds.left));
      const right = Math.min(image.width, Math.ceil(prefixBounds.right - textBounds.left));
      let ink = 0;
      for (let y = 0; y < image.height; y += 1) {
        for (let x = left; x < right; x += 1) {
          const offset = (y * image.width + x) * 4;
          const brightness = (data[offset]! + data[offset + 1]! + data[offset + 2]!) / 3;
          if (
            foregroundBrightness < backgroundBrightness
              ? brightness < threshold
              : brightness > threshold
          )
            ink += 1;
        }
      }
      return ink;
    },
    { base64: pixels.toString("base64"), prefixBounds: prefixRectangle },
  );
}
