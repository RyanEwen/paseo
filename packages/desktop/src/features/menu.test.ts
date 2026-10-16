import { describe, expect, it } from "vitest";
import { buildTerminalContextMenuTemplate, reloadActiveBrowserOrWindow } from "./menu.js";

class FakeWebContents {
  public readonly reloads: string[] = [];

  public constructor(public readonly id: number) {}

  public isLoadingMainFrame(): boolean {
    return false;
  }

  public stop(): void {
    this.reloads.push("stop");
  }

  public reload(): void {
    this.reloads.push("reload");
  }

  public reloadIgnoringCache(): void {
    this.reloads.push("force-reload");
  }
}

class BrowserReloads {
  public readonly firstWindow = { webContents: new FakeWebContents(101) };
  public readonly secondWindow = { webContents: new FakeWebContents(202) };
  public readonly firstBrowser = new FakeWebContents(11);
  public readonly secondBrowser = new FakeWebContents(22);
  public readonly resolvedHostWindowIds: number[] = [];

  public activeBrowserForHostWindow(hostWebContentsId: number): FakeWebContents | null {
    this.resolvedHostWindowIds.push(hostWebContentsId);
    return hostWebContentsId === 101 ? this.firstBrowser : this.secondBrowser;
  }
}

describe("reloadActiveBrowserOrWindow", () => {
  it("reloads only the active browser belonging to the supplied window", () => {
    const browserReloads = new BrowserReloads();

    reloadActiveBrowserOrWindow({
      win: browserReloads.firstWindow,
      getActiveBrowserContentsForHostWindow:
        browserReloads.activeBrowserForHostWindow.bind(browserReloads),
    });

    expect(browserReloads.resolvedHostWindowIds).toEqual([101]);
    expect(browserReloads.firstBrowser.reloads).toEqual(["reload"]);
    expect(browserReloads.secondBrowser.reloads).toEqual([]);
    expect(browserReloads.firstWindow.webContents.reloads).toEqual([]);
  });

  it("force reloads only the active browser belonging to the supplied window", () => {
    const browserReloads = new BrowserReloads();

    reloadActiveBrowserOrWindow({
      win: browserReloads.secondWindow,
      getActiveBrowserContentsForHostWindow:
        browserReloads.activeBrowserForHostWindow.bind(browserReloads),
      ignoreCache: true,
    });

    expect(browserReloads.resolvedHostWindowIds).toEqual([202]);
    expect(browserReloads.firstBrowser.reloads).toEqual([]);
    expect(browserReloads.secondBrowser.reloads).toEqual(["force-reload"]);
    expect(browserReloads.secondWindow.webContents.reloads).toEqual([]);
  });
});

describe("terminal link context menu", () => {
  const link = {
    url: "https://example.com/path",
    openInPaseo: true,
    labels: { internal: "Internal", external: "External", copy: "Copy link" },
  };

  it("preserves terminal editing roles and returns the chosen link action", () => {
    const actions: string[] = [];
    const items = buildTerminalContextMenuTemplate(
      { kind: "terminal", hasSelection: true, link },
      (action) => actions.push(action),
    );
    expect(items.map((item) => item.label ?? item.type)).toEqual([
      "Internal",
      "External",
      "Copy link",
      "separator",
      "Copy",
      "Paste",
      "separator",
      "Select All",
    ]);
    for (const item of items.slice(0, 3)) {
      item.click?.({} as Electron.MenuItem, undefined, {} as Electron.KeyboardEvent);
    }
    expect(actions).toEqual(["open-internal", "open-external", "copy-link"]);
    expect(items.filter((item) => item.role).map((item) => item.role)).toEqual([
      "copy",
      "paste",
      "selectAll",
    ]);
    expect(items.find((item) => item.role === "copy")?.enabled).toBe(true);
  });

  it("offers only external link actions without a workspace browser", () => {
    const items = buildTerminalContextMenuTemplate(
      { link: { ...link, openInPaseo: false } },
      () => {},
    );
    expect(items[0].label).toBe("External");
    expect(items.find((item) => item.role === "copy")?.enabled).toBe(false);
  });

  it.each(["file:///tmp/readme", "mailto:test@example.com", "invalid"])(
    "keeps non-HTTP target %s out of the link menu",
    (url) => {
      const items = buildTerminalContextMenuTemplate({ link: { ...link, url } }, () => {});
      expect(items.map((item) => item.role ?? item.type)).toEqual([
        "copy",
        "paste",
        "separator",
        "selectAll",
      ]);
    },
  );
});
