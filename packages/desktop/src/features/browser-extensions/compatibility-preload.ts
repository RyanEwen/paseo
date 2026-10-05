import { contextBridge, ipcRenderer } from "electron";

const CHANNEL = "paseo:extension-compatibility";
interface CompatibilityEvent {
  addListener(callback: (...args: unknown[]) => void, filter?: unknown): void;
  removeListener(callback: (...args: unknown[]) => void): void;
  hasListener(callback: (...args: unknown[]) => void): boolean;
  hasListeners(): boolean;
}
interface CompatibilityChrome {
  runtime: {
    id?: string;
    lastError?: { message: string };
    getManifest(): { permissions?: string[] };
  };
  tabs: Record<string, unknown>;
  scripting: {
    executeScript(input: {
      target: { tabId: number; frameIds?: number[]; allFrames?: boolean };
      func: () => string;
    }): Promise<Array<{ frameId: number; documentId: string; result: string }>>;
  };
  webNavigation?: Record<string, unknown>;
  notifications?: Record<string, unknown>;
  permissions?: Record<string, unknown>;
  windows?: Record<string, unknown>;
}
declare global {
  var chrome: CompatibilityChrome;
  var paseoExtensionCompatibility: {
    invoke(method: string, args: unknown[]): Promise<unknown>;
    listen(name: string, callback: (...args: unknown[]) => void): void;
  };
}

/** Isolated preload exposes a narrow authenticated RPC, only to actual extension pages/workers. */
const isExtension = contextBridge.executeInMainWorld({
  func: () => Boolean(globalThis.chrome?.runtime?.id),
});
if (isExtension) {
  contextBridge.exposeInMainWorld("paseoExtensionCompatibility", {
    invoke: (method: string, args: unknown[]) => ipcRenderer.invoke(CHANNEL, { method, args }),
    listen(name: string, callback: (...args: unknown[]) => void) {
      ipcRenderer.on(`${CHANNEL}:event`, (_event, eventName: string, args: unknown[]) => {
        if (eventName === name) {
          callback(...args);
        }
      });
    },
  });
  contextBridge.executeInMainWorld({ func: installCompatibility });
}

/** Install missing browser-owned namespaces while retaining Chromium storage, scripting and messaging. */
function installCompatibility(): void {
  const bridge = globalThis.paseoExtensionCompatibility;
  function event(name: string): CompatibilityEvent {
    const listeners = new Set<(...args: unknown[]) => void>();
    bridge.listen(name, (...args) => {
      for (const listener of listeners) {
        listener(...args);
      }
    });
    return {
      addListener(callback, filter) {
        if (filter !== undefined) {
          throw new Error("Filtered extension events are not supported in Paseo.");
        }
        listeners.add(callback);
      },
      removeListener(callback) {
        listeners.delete(callback);
      },
      hasListener(callback) {
        return listeners.has(callback);
      },
      hasListeners() {
        return listeners.size > 0;
      },
    };
  }
  function callbackResult(
    result: Promise<unknown>,
    callback: unknown,
  ): Promise<unknown> | undefined {
    if (typeof callback !== "function") {
      return result;
    }
    const callbackFunction = callback;
    async function deliverCallback(): Promise<void> {
      let value: unknown;
      try {
        value = await result;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const descriptor = Object.getOwnPropertyDescriptor(chrome.runtime, "lastError");
        Object.defineProperty(chrome.runtime, "lastError", {
          configurable: true,
          get: () => ({ message }),
        });
        try {
          callbackFunction();
        } finally {
          if (descriptor) {
            Object.defineProperty(chrome.runtime, "lastError", descriptor);
          } else {
            delete chrome.runtime.lastError;
          }
        }
        return;
      }
      callbackFunction(value);
    }
    void deliverCallback();
    return undefined;
  }
  function method(name: string) {
    return (...input: unknown[]): Promise<unknown> | undefined => {
      const args = [...input];
      const last = args.at(-1);
      const callback = typeof last === "function" ? last : null;
      if (callback) {
        args.pop();
      }
      const result = bridge.invoke(name, args);
      return callbackResult(result, callback);
    };
  }
  chrome.webNavigation = {
    onCommitted: event("webNavigation.onCommitted"),
    onCompleted: event("webNavigation.onCompleted"),
    onErrorOccurred: event("webNavigation.onErrorOccurred"),
  };
  /** Obtain document IDs from Chromium scripting results, so navigation races fail the caller's document guard. */
  async function frames(input: { tabId: number; frameId?: number }, all: boolean) {
    const methodName = all ? "webNavigation.getAllFrames" : "webNavigation.getFrame";
    const metadata = await bridge.invoke(methodName, [input]);
    if (metadata === null) {
      return null;
    }
    const target = all
      ? { tabId: input.tabId, allFrames: true }
      : { tabId: input.tabId, frameIds: [input.frameId ?? 0] };
    const injections = await chrome.scripting.executeScript({ target, func: () => location.href });
    function enrich(detail: unknown) {
      if (
        typeof detail !== "object" ||
        detail === null ||
        !("frameId" in detail) ||
        !("url" in detail)
      ) {
        throw new Error("Invalid navigation frame metadata.");
      }
      const injection = injections.find((item) => item.frameId === detail.frameId);
      if (
        !injection ||
        typeof injection.documentId !== "string" ||
        injection.result !== detail.url
      ) {
        throw new Error("The browser document changed while reading frame details.");
      }
      return { ...detail, documentId: injection.documentId };
    }
    return all && Array.isArray(metadata) ? metadata.map(enrich) : enrich(metadata);
  }
  if (chrome.webNavigation) {
    chrome.webNavigation.getFrame = (
      input: { tabId: number; frameId?: number },
      callback?: unknown,
    ) => callbackResult(frames(input, false), callback);
    chrome.webNavigation.getAllFrames = (input: { tabId: number }, callback?: unknown) =>
      callbackResult(frames(input, true), callback);
  }
  chrome.notifications = {
    onClicked: event("notifications.onClicked"),
    onButtonClicked: event("notifications.onButtonClicked"),
    onClosed: event("notifications.onClosed"),
    create: method("notifications.create"),
    clear: method("notifications.clear"),
  };
  chrome.permissions = {
    onAdded: event("permissions.onAdded"),
    onRemoved: event("permissions.onRemoved"),
    contains: method("permissions.contains"),
    request: method("permissions.request"),
  };
  chrome.windows = {
    onCreated: event("windows.onCreated"),
    onRemoved: event("windows.onRemoved"),
    onFocusChanged: event("windows.onFocusChanged"),
    WINDOW_ID_CURRENT: -2,
    WINDOW_ID_NONE: -1,
    getCurrent: method("windows.getCurrent"),
    getAll: method("windows.getAll"),
    get: method("windows.get"),
  };
  chrome.tabs.getCurrent = method("tabs.getCurrent");
  if (chrome.runtime.getManifest().permissions?.includes("tabs")) {
    chrome.tabs.query = method("tabs.query");
  }
}
