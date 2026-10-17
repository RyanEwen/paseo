import type { Locator } from "@playwright/test";

/** Observe a real click and stationary-pointer ownership without driving input.
 * Samples at most 24 animation frames from pointerdown, plus a final explicit read.
 * Call dispose in finally to remove both listeners and cancel pending sampling.
 */
export async function observePromptPointer(control: Locator) {
  const remote = await control.evaluateHandle((node) => {
    interface Point {
      x: number;
      y: number;
    }

    const bounds = (element: Element | null) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    // The masked original exposes action-row aria-hidden; record that public state, not React internals.
    const readControls = (row: Element | null) => {
      if (!row)
        return {
          trailingOpacity: null,
          trailingPointerEvents: null,
          trailingAriaHidden: null,
          trailingBounds: null,
          buttons: [],
        };
      const style = getComputedStyle(row);
      const buttons = Array.from(row.querySelectorAll('[role="button"],button')).map((button) => ({
        label: button.getAttribute("aria-label"),
        testId: button.getAttribute("data-testid"),
        disabled: button.getAttribute("aria-disabled"),
        bounds: bounds(button),
      }));
      return {
        trailingOpacity: style.opacity,
        trailingPointerEvents: style.pointerEvents,
        trailingAriaHidden: row.getAttribute("aria-hidden"),
        trailingBounds: bounds(row),
        buttons,
      };
    };
    const readMessage = (original: Element | null, target: Element | null) => {
      if (!original)
        return {
          hitInsideOriginal: false,
          hitInsideHoverWrapper: false,
          wrapperHovered: false,
          wrapperBounds: null,
          bubbleBounds: null,
          historyRowId: null,
          pinnedOwner: false,
          ...readControls(null),
        };
      const bubble = original.querySelector('[data-testid="user-message-bubble"]');
      const wrapper = bubble?.parentElement ?? null;
      const row = original.querySelector('[data-testid="user-message-trailing-row"]');
      return {
        hitInsideOriginal: target !== null && original.contains(target),
        hitInsideHoverWrapper: target !== null && wrapper !== null && wrapper.contains(target),
        wrapperHovered: wrapper !== null && wrapper.matches(":hover"),
        wrapperBounds: bounds(wrapper),
        bubbleBounds: bounds(bubble),
        historyRowId:
          original.closest("[data-history-row-id]")?.getAttribute("data-history-row-id") ?? null,
        pinnedOwner: original.closest('[data-testid="sticky-user-message"]') !== null,
        ...readControls(row),
      };
    };
    const readHit = (point: Point, expected: Element | null = null) => {
      const target = document.elementFromPoint(point.x, point.y);
      const original = expected ?? target?.closest('[data-testid="user-message"]') ?? null;
      return {
        ...readMessage(original, target),
        hitTag: target?.tagName ?? null,
        hitTestId: target?.getAttribute("data-testid") ?? null,
      };
    };
    const state = {
      point: null as Point | null,
      movesAfterClick: 0,
      actions: [] as {
        type: string;
        trusted: boolean;
        x: number;
        y: number;
        targetTestId: string | null;
        hitTestId: string | null;
        snapshot: ReturnType<typeof readHit>;
      }[],
      frames: [] as (ReturnType<typeof readHit> & { at: number })[],
    };
    let frame: number | null = null;
    let stopped = false;
    const sample = () => {
      if (stopped || !state.point) return;
      state.frames.push({ ...readHit(state.point), at: performance.now() });
      if (state.frames.length < 24) frame = requestAnimationFrame(sample);
    };
    const recordDown = (event: Event) => {
      const pointer = event as PointerEvent;
      state.point = { x: pointer.clientX, y: pointer.clientY };
      frame = requestAnimationFrame(sample);
    };
    const recordMove = (event: PointerEvent) => {
      if (state.point && (event.clientX !== state.point.x || event.clientY !== state.point.y))
        state.movesAfterClick += 1;
    };
    const recordAction = (event: Event) => {
      if (state.actions.length >= 12) return;
      const pointer = event as MouseEvent;
      const target = event.target instanceof Element ? event.target : null;
      const hit = document.elementFromPoint(pointer.clientX, pointer.clientY);
      state.actions.push({
        type: event.type,
        snapshot: readHit({ x: pointer.clientX, y: pointer.clientY }),
        trusted: event.isTrusted,
        x: pointer.clientX,
        y: pointer.clientY,
        targetTestId: target?.closest("[data-testid]")?.getAttribute("data-testid") ?? null,
        hitTestId: hit?.closest("[data-testid]")?.getAttribute("data-testid") ?? null,
      });
    };
    for (const type of ["pointerdown", "pointerup", "click"])
      window.addEventListener(type, recordAction, true);
    node.addEventListener("pointerdown", recordDown, { once: true });
    window.addEventListener("pointermove", recordMove);
    return {
      state,
      read(expected: Element) {
        if (!state.point) throw new Error("The real previous-arrow pointerdown was not captured");
        return { ...state, ...readHit(state.point, expected) };
      },
      snapshot() {
        if (!state.point) return { ...state, hitAvailable: false };
        return { ...state, hitAvailable: true, ...readHit(state.point) };
      },
      stop() {
        stopped = true;
        if (frame !== null) cancelAnimationFrame(frame);
        for (const type of ["pointerdown", "pointerup", "click"])
          window.removeEventListener(type, recordAction, true);
        node.removeEventListener("pointerdown", recordDown);
        window.removeEventListener("pointermove", recordMove);
      },
    };
  });
  return {
    /** Read the intended original after canonical settlement, retaining all prior frame observations. */
    async read(original: Locator) {
      const element = await original.elementHandle();
      if (!element) throw new Error("The original prompt is not mounted");
      try {
        return await remote.evaluate((observation, target) => observation.read(target), element);
      } finally {
        await element.dispose();
      }
    },
    /** Preserve the actual hit and ownership frames even when canonical landing itself fails. */
    async snapshot() {
      return remote.evaluate((observation) => observation.snapshot());
    },
    /** Release only this test's observational resources, including after navigation errors. */
    async dispose() {
      await remote.evaluate((observation) => observation.stop()).catch(() => {});
      await remote.dispose();
    },
  };
}
