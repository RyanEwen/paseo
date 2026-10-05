import React from "react";
import { BrowserDataSection } from "./browser-data-section";
import { BrowserExtensionsSection } from "./extensions-section";

/** Group the browser's profile controls under its existing settings destination. */
export function BrowserSettingsSection() {
  return (
    <>
      <BrowserExtensionsSection />
      <BrowserDataSection />
    </>
  );
}
