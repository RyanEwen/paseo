import type { DesktopNativeBrowserState } from "@/desktop/host";
import { createNativeBrowserSession, type NativeBrowserSession } from "./native-session.electron";

export interface BrowserPage extends EventTarget {
  readonly isConnected: boolean;
  canGoBack(): boolean;
  canGoForward(): boolean;
  getURL(): string;
  isLoading(): boolean;
  loadURL(url: string): Promise<void>;
  executeJavaScript(code: string): Promise<unknown>;
  goBack(): void;
  goForward(): void;
  reload(): void;
  stop(): void;
  focus(): void;
}
export interface NativeBrowserPage extends BrowserPage {
  present(
    bounds: BrowserBounds,
    visible: boolean,
    clip: BrowserBounds | undefined,
    viewportMode: "fixed" | "responsive",
  ): Promise<void>;
  getPresentationScale(): number;
  close(): Promise<void>;
}
export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Mirror native page state into the pane's existing navigation/annotation events.
 * This proxy owns no DOM browser, pixels, profile or native focus. Main remains
 * authoritative and all commands carry the exact contents identity.
 */
export function createNativeBrowserPage(
  input: {
    browserId: string;
    workspaceId: string;
    url: string;
  },
  createSession: typeof createNativeBrowserSession = createNativeBrowserSession,
): NativeBrowserPage {
  const events = new EventTarget();
  let state: DesktopNativeBrowserState | null = null;
  let connected = true;
  let presentationVersion = 0;
  let presentationTail: Promise<void> = Promise.resolve();
  function emit(name: string, fields: Record<string, unknown> = {}): void {
    const event = Object.assign(new Event(name), fields);
    events.dispatchEvent(event);
  }
  /** Keep native focus and frame-layout observations separate from document events. */
  function emitPresentationChanges(
    next: DesktopNativeBrowserState,
    previous: DesktopNativeBrowserState | null,
  ): void {
    if (next.presentationScale !== previous?.presentationScale) emit("presentation-changed");
    if (next.focused && !previous?.focused) emit("focus");
  }
  function receive(next: DesktopNativeBrowserState): void {
    if (!connected) return;
    const previous = state;
    state = next;
    emitPresentationChanges(next, previous);
    if (next.url !== previous?.url) emit("did-navigate", { url: next.url });
    if (next.title !== previous?.title) emit("page-title-updated", { title: next.title });
    if (next.faviconUrl !== previous?.faviconUrl)
      emit("page-favicon-updated", { favicons: next.faviconUrl ? [next.faviconUrl] : [] });
    if (next.isLoading !== previous?.isLoading) {
      emit(next.isLoading ? "did-start-loading" : "did-stop-loading");
      if (!next.isLoading) emit("dom-ready");
    }
    if (next.lastError && next.lastError !== previous?.lastError)
      emit("did-fail-load", { errorDescription: next.lastError, isMainFrame: true });
  }
  const ready = createSession({ ...input, onState: receive });
  // Surface initialization failures to the attached pane even before it sends a command.
  void ready.catch((error) =>
    emit("did-fail-load", { errorDescription: String(error), isMainFrame: true }),
  );
  async function command(run: (session: NativeBrowserSession) => Promise<unknown>): Promise<void> {
    try {
      await run(await ready);
    } catch (error) {
      emit("did-fail-load", { errorDescription: String(error), isMainFrame: true });
    }
  }
  return {
    get isConnected() {
      return connected;
    },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
    canGoBack: () => state?.canGoBack ?? false,
    canGoForward: () => state?.canGoForward ?? false,
    getURL: () => state?.url ?? input.url,
    isLoading: () => state?.isLoading ?? true,
    loadURL: async (url) => (await ready).navigate(url),
    executeJavaScript: async (code) => (await ready).executeScript(code),
    goBack: () => {
      void command((session) => session.control("back"));
    },
    goForward: () => {
      void command((session) => session.control("forward"));
    },
    reload: () => {
      void command((session) => session.control("reload"));
    },
    stop: () => {
      void command((session) => session.control("stop"));
    },
    focus: () => {
      void command((session) => session.focus());
    },
    getPresentationScale: () => state?.presentationScale ?? 1,
    present(bounds, visible, clip, viewportMode) {
      const version = ++presentationVersion;
      const previous = presentationTail;
      const next = async () => {
        try {
          await previous;
        } catch {
          /* A failed earlier layout must not block a newer hide. */
        }
        const session = await ready;
        if (!connected || version !== presentationVersion) return;
        await session.present(bounds, visible, clip, viewportMode);
      };
      presentationTail = next();
      return presentationTail;
    },
    async close() {
      if (!connected) return;
      connected = false;
      presentationVersion++;
      await (await ready).close();
    },
  };
}
