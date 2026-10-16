import { describe, expect, it } from "vitest";
import { getExtensionPopupUrl } from "./manifest.js";

const id = "abcdefghijklmnopabcdefghijklmnop";

describe("extension toolbar popup", () => {
  it.each(["action", "browser_action", "page_action"])("resolves %s packaged popup", (kind) => {
    expect(getExtensionPopupUrl(id, { [kind]: { default_popup: "popup/index.html" } })).toBe(
      `chrome-extension://${id}/popup/index.html`,
    );
  });

  it.each([
    "https://example.com/",
    "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/",
    "//example.com/a",
    "http://[invalid",
  ])("rejects popup outside the extension: %s", (default_popup) => {
    expect(getExtensionPopupUrl(id, { action: { default_popup } })).toBeNull();
  });

  it("does not invent a popup for background-only extensions", () => {
    expect(getExtensionPopupUrl(id, { action: {} })).toBeNull();
    expect(getExtensionPopupUrl(id, {})).toBeNull();
  });
});
