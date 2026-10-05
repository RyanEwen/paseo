import { describe, expect, it } from "vitest";
import { coversExtensionOrigin, matchesExtensionUrl } from "./host-patterns.js";

describe("extension URL patterns", () => {
  it("keeps host punctuation literal", () => {
    expect(matchesExtensionUrl("https://example.com/*", "https://example.com/a")).toBe(true);
    expect(matchesExtensionUrl("https://example.com/*", "https://exampleXcom/a")).toBe(false);
  });
  it("includes wildcard host apex and true subdomains", () => {
    expect(matchesExtensionUrl("https://*.example.com/*", "https://example.com/a")).toBe(true);
    expect(matchesExtensionUrl("https://*.example.com/*", "https://deep.example.com/a")).toBe(true);
    expect(matchesExtensionUrl("https://*.example.com/*", "https://badexample.com/a")).toBe(false);
  });
  it("restricts wildcard scheme to HTTP and HTTPS", () => {
    expect(matchesExtensionUrl("*://*/*", "http://example.com/a")).toBe(true);
    expect(matchesExtensionUrl("*://*/*", "ftp://example.com/a")).toBe(false);
    expect(matchesExtensionUrl("<all_urls>", "file:///tmp/a")).toBe(true);
    expect(matchesExtensionUrl("<all_urls>", "chrome-extension://id/a")).toBe(false);
  });
  it("matches paths with literal regex characters", () => {
    expect(matchesExtensionUrl("https://example.com/a.b*", "https://example.com/a.b?x=y")).toBe(
      true,
    );
    expect(matchesExtensionUrl("https://example.com/a.b*", "https://example.com/aXb")).toBe(false);
  });
});

describe("required extension host permission containment", () => {
  it("covers narrow origins from all URLs", () => {
    expect(coversExtensionOrigin("<all_urls>", "https://example.com/*")).toBe(true);
    expect(coversExtensionOrigin("*://*.example.com/*", "https://example.com/*")).toBe(true);
    expect(coversExtensionOrigin("https://example.com/*", "http://example.com/*")).toBe(false);
    expect(coversExtensionOrigin("https://example.com/*", "https://*.example.com/*")).toBe(false);
    expect(coversExtensionOrigin("https://*.example.com/*", "https://*.other.example.com/*")).toBe(
      true,
    );
  });
});
