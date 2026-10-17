import { describe, expect, it } from "vitest";
import {
  openWorkspaceBrowser,
  workspaceBrowserLinkDestinations,
} from "@/workspace/browser/opening";
import { createPluginHostNavigation } from "./host-navigation-model";

describe("plugin host navigation", () => {
  function setup(electron = true) {
    const destinations: unknown[] = [];
    const browsers: string[] = [];
    const workspaces = new Set(["selected:one", "remote:two"]);
    const navigation = createPluginHostNavigation("selected", {
      browserAvailable: electron,
      resolveWorkspace: ({ serverId, workspaceId }) =>
        workspaces.has(`${serverId}:${workspaceId}`) ? workspaceId : null,
      openAgent: (input) => destinations.push(input),
      openWorkspace: (input) => destinations.push(input),
      createBrowser: ({ initialUrl }) => {
        browsers.push(initialUrl);
        return { browserId: `browser-${browsers.length}` };
      },
    });
    return { navigation, destinations, browsers, workspaces };
  }

  it("creates and focuses a local browser in the selected or explicit host workspace", () => {
    const { navigation, destinations, browsers } = setup();
    navigation.openBrowser!({ url: "https://example.com/one", workspaceId: "one" });
    navigation.openBrowser!({
      url: "https://example.com/two",
      workspaceId: "two",
      serverId: "remote",
    });
    expect(browsers).toEqual(["https://example.com/one", "https://example.com/two"]);
    expect(destinations).toEqual([
      {
        serverId: "selected",
        workspaceId: "one",
        target: { kind: "browser", browserId: "browser-1" },
      },
      {
        serverId: "remote",
        workspaceId: "two",
        target: { kind: "browser", browserId: "browser-2" },
      },
    ]);
  });

  it("refuses unknown or removed workspaces before creating browser records", () => {
    const { navigation, destinations, browsers, workspaces } = setup();
    expect(() =>
      navigation.openBrowser!({ url: "https://example.com", workspaceId: "missing" }),
    ).toThrow("Workspace is unavailable");
    expect(() =>
      navigation.openBrowser!({
        url: "https://example.com",
        workspaceId: "one",
        serverId: "unknown",
      }),
    ).toThrow("Workspace is unavailable");
    workspaces.delete("selected:one");
    expect(() =>
      navigation.openBrowser!({ url: "https://example.com", workspaceId: "one" }),
    ).toThrow("Workspace is unavailable");
    expect(destinations).toEqual([]);
    expect(browsers).toEqual([]);
  });

  it("exposes no browser capability outside Electron and creates no tabs", () => {
    const { navigation, destinations, browsers } = setup(false);
    expect(navigation.openBrowser).toBeUndefined();
    expect(destinations).toEqual([]);
    expect(browsers).toEqual([]);
  });

  it.each(["javascript:alert(1)", "file:///tmp/file", "/relative", "invalid"])(
    "rejects %s before creating a browser",
    (url) => {
      const { navigation, browsers, destinations } = setup();
      expect(() => navigation.openBrowser!({ url, workspaceId: "one" })).toThrow("HTTP(S)");
      expect(browsers).toEqual([]);
      expect(destinations).toEqual([]);
    },
  );

  it("rejects an empty workspace before creating a browser", () => {
    const { navigation, browsers } = setup();
    expect(() => navigation.openBrowser!({ url: "https://example.com", workspaceId: "" })).toThrow(
      "workspaceId",
    );
    expect(browsers).toEqual([]);
  });
  it("opens chat URLs in the resolved workspace key without rewriting their query or fragment", () => {
    const created: string[] = [];
    const destinations: unknown[] = [];
    const url = "http://localhost:8181/path?q=one%20two#details";
    openWorkspaceBrowser(
      { serverId: "host", workspaceId: "workspace-id", url },
      {
        resolveWorkspace: ({ serverId, workspaceId }) => {
          expect({ serverId, workspaceId }).toEqual({
            serverId: "host",
            workspaceId: "workspace-id",
          });
          return "canonical-map-key";
        },
        createBrowser: ({ initialUrl }) => {
          created.push(initialUrl);
          return { browserId: "chat-browser" };
        },
        openWorkspace: (input) => destinations.push(input),
      },
    );
    expect(created).toEqual([url]);
    expect(destinations).toEqual([
      {
        serverId: "host",
        workspaceId: "canonical-map-key",
        target: { kind: "browser", browserId: "chat-browser" },
      },
    ]);
  });

  it("does not focus a tab when browser creation fails", () => {
    const destinations: unknown[] = [];
    expect(() =>
      openWorkspaceBrowser(
        { serverId: "host", workspaceId: "one", url: "https://example.com" },
        {
          resolveWorkspace: () => "one",
          createBrowser: () => {
            throw new Error("Browser storage unavailable");
          },
          openWorkspace: (input) => destinations.push(input),
        },
      ),
    ).toThrow("Browser storage unavailable");
    expect(destinations).toEqual([]);
  });
});

describe("workspace browser link menu policy", () => {
  it("offers internal opening for associated external-default links", () => {
    expect(
      workspaceBrowserLinkDestinations({
        url: "https://github.com/acme/repo",
        hasWorkspaceBrowser: true,
        defaultDestination: "external",
      }),
    ).toEqual(["paseo", "external"]);
  });

  it("offers external opening for chat links without changing their primary action", () => {
    expect(
      workspaceBrowserLinkDestinations({
        url: "http://localhost:8181",
        hasWorkspaceBrowser: true,
        defaultDestination: "paseo",
      }),
    ).toEqual(["external"]);
  });

  it("leaves global links without a workspace opener unchanged", () => {
    expect(
      workspaceBrowserLinkDestinations({
        url: "https://example.com",
        hasWorkspaceBrowser: false,
        defaultDestination: "external",
      }),
    ).toEqual([]);
  });

  it.each([
    "file:///tmp/readme.md",
    "mailto:ryan@example.com",
    "/src/file.ts",
    "javascript:alert(1)",
    null,
    undefined,
  ])("does not offer browser destinations for %s", (url) => {
    expect(
      workspaceBrowserLinkDestinations({
        url,
        hasWorkspaceBrowser: true,
        defaultDestination: "external",
      }),
    ).toEqual([]);
  });
});
