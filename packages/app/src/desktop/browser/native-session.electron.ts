import { getDesktopHost, type DesktopNativeBrowserState } from "@/desktop/host";

export interface NativeBrowserSession {
  state(): DesktopNativeBrowserState;
  present(
    bounds: { x: number; y: number; width: number; height: number },
    visible: boolean,
    clip: { x: number; y: number; width: number; height: number } | undefined,
    viewportMode: "fixed" | "responsive",
  ): Promise<void>;
  navigate(url: string): Promise<void>;
  executeScript(code: string): Promise<unknown>;
  control(command: "back" | "forward" | "reload" | "stop"): Promise<void>;
  focus(): Promise<boolean>;
  close(): Promise<void>;
  detach(): Promise<void>;
}

/** Attach a renderer proxy to a retained, main-owned native browser.
 * Subscribe before creation and apply buffered events after the initial snapshot.
 * Detaching hides presentation without closing drafts; only explicit close retires
 * contents. This seam supplies no screenshot or blank-content substitute.
 */
export async function createNativeBrowserSession(input: {
  browserId: string;
  workspaceId: string;
  url: string;
  onState(state: DesktopNativeBrowserState): void;
}): Promise<NativeBrowserSession> {
  const host = getDesktopHost();
  const views = host?.browser?.views;
  const subscribe = host?.events?.on;
  if (!views || !subscribe) throw new Error("The desktop native browser bridge is unavailable");
  const nativeViews = views;
  let current: DesktopNativeBrowserState | null = null;
  const buffered: DesktopNativeBrowserState[] = [];
  let detached = false;
  let closed = false;
  let viewportMode: "fixed" | "responsive" = "fixed";
  let bounds = { x: 0, y: 0, width: 1280, height: 800 };
  const unsubscribe = await subscribe("browser-view-state", (payload: unknown) => {
    if (detached || !payload || typeof payload !== "object") return;
    const receivedState = payload as DesktopNativeBrowserState;
    if (
      receivedState.browserId !== input.browserId ||
      receivedState.workspaceId !== input.workspaceId
    )
      return;
    if (current === null) {
      // The IPC sender is main; cap buffering while its initial snapshot is pending.
      if (buffered.length === 16) buffered.shift();
      buffered.push(receivedState);
    } else if (receivedState.webContentsId === current.webContentsId) {
      current = receivedState;
      input.onState(receivedState);
    }
  });
  try {
    current = await views.create({
      browserId: input.browserId,
      workspaceId: input.workspaceId,
      url: input.url,
    });
    for (const bufferedState of buffered) {
      if (bufferedState.webContentsId === current.webContentsId) current = bufferedState;
    }
    buffered.length = 0;
    input.onState(current);
  } catch (error) {
    unsubscribe();
    throw error;
  }
  function state(): DesktopNativeBrowserState {
    if (current === null) throw new Error("Native browser initial state is unavailable");
    return current;
  }
  /** Prevent an already detached UI proxy from re-presenting a retained page. */
  function assertAttached(): void {
    if (detached) throw new Error("Native browser renderer session is detached");
  }
  async function detach(): Promise<void> {
    if (detached) return;
    detached = true;
    unsubscribe();
    await nativeViews.present({
      browserId: input.browserId,
      webContentsId: state().webContentsId,
      visible: false,
      viewportMode,
      bounds,
    });
  }
  return {
    state,
    async present(nextBounds, visible, clip, mode) {
      assertAttached();
      bounds = nextBounds;
      viewportMode = mode;
      current = await views.present({
        browserId: input.browserId,
        webContentsId: state().webContentsId,
        visible,
        viewportMode,
        bounds,
        ...(clip ? { clip } : {}),
      });
      input.onState(current);
    },
    async navigate(url) {
      assertAttached();
      await views.navigate(input.browserId, state().webContentsId, url);
    },
    async executeScript(code) {
      assertAttached();
      return views.executeScript(input.browserId, state().webContentsId, code);
    },
    async control(command) {
      assertAttached();
      current = await views.control(input.browserId, state().webContentsId, command);
      input.onState(current);
    },
    async focus() {
      assertAttached();
      return views.focus(input.browserId, state().webContentsId);
    },
    async close() {
      if (closed) return;
      closed = true;
      detached = true;
      unsubscribe();
      await views.close(input.browserId, state().webContentsId);
    },
    detach,
  };
}
