import { expect, type Page } from "@playwright/test";

interface MotionFrame {
  at: number;
  top: number;
  connected: boolean;
  sameNode: boolean;
  duration: number | null;
  group: string | null;
}

interface MotionProbe {
  frames: MotionFrame[];
  paused: boolean;
  animation: Animation | null;
  stop: boolean;
}

type MotionWindow = Window & { __sidebarMotionProbe?: MotionProbe };

/** Seed the canonical app preference and real sidebar projection before app hydration. */
export async function seedSidebarMotionPreferences({
  page,
  enabled,
  groupMode = "status",
  workspaceSortMode = "status",
}: {
  page: Page;
  enabled: boolean;
  groupMode?: "project" | "status";
  workspaceSortMode?: "status" | "name";
}) {
  await page.addInitScript(
    ({ motionEnabled, grouping, sorting }) => {
      if (!localStorage.getItem("@paseo:app-settings")) {
        localStorage.setItem(
          "@paseo:app-settings",
          JSON.stringify({
            workspaceTitleSource: "title",
            paseoPlusPlus: { sidebarWorkspaceTransitions: motionEnabled },
          }),
        );
      }
      localStorage.setItem(
        "sidebar-view",
        JSON.stringify({
          state: { groupMode: grouping, workspaceSortMode: sorting },
          version: 11,
        }),
      );
    },
    { motionEnabled: enabled, grouping: groupMode, sorting: workspaceSortMode },
  );
}

/** Observe painted geometry without replacing browser or animation APIs. Freeze once for pixel evidence. */
export async function startSidebarMotionProbe({
  page,
  rowTestId,
  freeze = false,
}: {
  page: Page;
  rowTestId: string;
  freeze?: boolean;
}) {
  await page.getByTestId(rowTestId).evaluate((row, pauseForCapture) => {
    const win = window as MotionWindow;
    const testId = row.getAttribute("data-testid");
    const probe: MotionProbe = { frames: [], paused: false, animation: null, stop: false };
    win.__sidebarMotionProbe = probe;
    const start = performance.now();
    function capture() {
      if (probe.stop) return;
      const wrapper = row.closest("[data-position-transition]");
      const animation =
        wrapper?.getAnimations().find((candidate) => candidate.playState === "running") ?? null;
      const timing = animation?.effect?.getTiming();
      const duration = typeof timing?.duration === "number" ? timing.duration : null;
      if (
        pauseForCapture &&
        !probe.paused &&
        animation &&
        typeof animation.currentTime === "number" &&
        animation.currentTime >= 25
      ) {
        animation.pause();
        probe.animation = animation;
        probe.paused = true;
      }
      probe.frames.push({
        at: performance.now() - start,
        top: row.getBoundingClientRect().top,
        connected: row.isConnected,
        sameNode: document.querySelector(`[data-testid="${testId}"]`) === row,
        duration,
        group:
          row.closest('[data-testid^="sidebar-status-group-rows-"]')?.getAttribute("data-testid") ??
          null,
      });
      requestAnimationFrame(capture);
    }
    requestAnimationFrame(capture);
  }, freeze);
}

/** Resume the genuine paused transition after capturing its intermediate painted state. */
export async function resumeSidebarMotion(page: Page) {
  await page.evaluate(() => {
    const probe = (window as MotionWindow).__sidebarMotionProbe;
    if (!probe) throw new Error("Motion probe was not started");
    probe.animation?.play();
  });
}

export async function expectSidebarMotionPaused(page: Page) {
  await expect
    .poll(() => page.evaluate(() => (window as MotionWindow).__sidebarMotionProbe?.paused))
    .toBe(true);
}

/** Stop the frame observer and return serializable motion and identity evidence. */
export async function stopSidebarMotionProbe(page: Page): Promise<MotionFrame[]> {
  return page.evaluate(() => {
    const probe = (window as MotionWindow).__sidebarMotionProbe;
    if (!probe) throw new Error("Motion probe was not started");
    probe.stop = true;
    return probe.frames;
  });
}
