import { describe, expect, it } from "vitest";
import type { BrowserExtensionTab } from "./tab-projection.js";
import {
  canReadSensitiveTab,
  describeVisibleExtensionTab,
  describeVisibleExtensionTabChanges,
} from "./tab-access.js";

const id = "a".repeat(32);
const tab: BrowserExtensionTab = {
  id: 21,
  windowId: 3,
  index: 0,
  active: true,
  highlighted: true,
  url: "https://example.com/private",
  title: "Private document",
  incognito: false,
  status: "complete",
};
function extension(manifest: unknown = {}) {
  return { id, manifest };
}

describe("extension tab metadata access", () => {
  it("preserves basic identity and omits sensitive fields without a grant", () => {
    const visible = describeVisibleExtensionTab(extension(), tab);
    expect(visible).toEqual({
      id: 21,
      windowId: 3,
      index: 0,
      active: true,
      highlighted: true,
      incognito: false,
      status: "complete",
    });
    expect(tab.url).toBe("https://example.com/private");
    expect(tab.title).toBe("Private document");
    expect(
      describeVisibleExtensionTabChanges(
        extension(),
        { url: tab.url, title: tab.title, status: "loading" },
        tab,
      ),
    ).toEqual({ status: "loading" });
    expect(describeVisibleExtensionTabChanges(extension(), { title: tab.title }, tab)).toEqual({});
  });

  it("allows explicit tabs permission and own extension documents, but not foreign extension origins", () => {
    expect(describeVisibleExtensionTab(extension({ permissions: ["tabs"] }), tab)).toEqual(tab);
    const owned = { ...tab, url: `chrome-extension://${id}/popup.html?route=login` };
    expect(describeVisibleExtensionTab(extension(), owned)).toEqual(owned);
    expect(
      canReadSensitiveTab(extension(), {
        ...owned,
        url: `chrome-extension://${"b".repeat(32)}/popup.html`,
      }),
    ).toBe(false);
    expect(
      canReadSensitiveTab(extension({ host_permissions: ["<all_urls>"] }), {
        ...owned,
        url: `chrome-extension://${"b".repeat(32)}/popup.html`,
      }),
    ).toBe(false);
  });

  it("matches required host grants by scheme and host while ignoring grant paths", () => {
    const granted = extension({ host_permissions: ["https://*.example.com/only-this-path"] });
    expect(canReadSensitiveTab(granted, tab)).toBe(true);
    expect(canReadSensitiveTab(granted, { ...tab, url: "https://sub.example.com/another" })).toBe(
      true,
    );
    expect(canReadSensitiveTab(granted, { ...tab, url: "http://example.com/private" })).toBe(false);
    expect(canReadSensitiveTab(granted, { ...tab, url: "https://exampleXcom/private" })).toBe(
      false,
    );
    expect(
      canReadSensitiveTab(granted, { ...tab, url: "https://example.com.evil.test/private" }),
    ).toBe(false);
    expect(canReadSensitiveTab(extension({ permissions: ["https://example.com/path"] }), tab)).toBe(
      true,
    );
    expect(
      describeVisibleExtensionTabChanges(granted, { url: tab.url, title: tab.title }, tab),
    ).toEqual({ url: tab.url, title: tab.title });
  });

  it("allows IPv6 pages through wildcard host grants without inventing exact-host matches", () => {
    const ipv6 = { ...tab, url: "https://[::1]:8443/private" };
    expect(canReadSensitiveTab(extension({ host_permissions: ["<all_urls>"] }), ipv6)).toBe(true);
    expect(
      canReadSensitiveTab(extension({ host_permissions: ["https://*/restricted-path"] }), ipv6),
    ).toBe(true);
    expect(canReadSensitiveTab(extension({ host_permissions: ["http://*/*"] }), ipv6)).toBe(false);
    expect(
      canReadSensitiveTab(extension({ host_permissions: ["https://example.com/*"] }), ipv6),
    ).toBe(false);
  });

  it("does not globally grant optional permissions or activeTab", () => {
    const pending = extension({
      permissions: ["activeTab"],
      optional_permissions: ["tabs"],
      optional_host_permissions: ["<all_urls>"],
    });
    expect(canReadSensitiveTab(pending, tab)).toBe(false);
    expect(canReadSensitiveTab(extension(), { ...tab, url: "" })).toBe(false);
    expect(canReadSensitiveTab(extension({ permissions: ["tabs"] }), { ...tab, url: "" })).toBe(
      true,
    );
  });

  it("does not expose browser-internal or opaque page metadata through all-URL host grants", () => {
    const granted = extension({ host_permissions: ["<all_urls>"] });
    for (const url of ["about:blank", "chrome://settings/", "data:text/plain,private"]) {
      expect(canReadSensitiveTab(granted, { ...tab, url })).toBe(false);
    }
  });

  it("redacts metadata after navigating away from a granted host", () => {
    const granted = extension({ host_permissions: ["https://example.com/*"] });
    const moved = {
      ...tab,
      url: "https://another.test/private",
      title: "Another private document",
    };
    expect(
      describeVisibleExtensionTabChanges(
        granted,
        { url: moved.url, title: moved.title, status: "loading" },
        moved,
      ),
    ).toEqual({ status: "loading" });
    expect(describeVisibleExtensionTab(granted, moved)).not.toHaveProperty("url");
  });
});
