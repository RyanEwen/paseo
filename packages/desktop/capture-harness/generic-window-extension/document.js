window.paseoGenericDocumentState = (async () => ({
  tab: await chrome.tabs.getCurrent(),
  window: await chrome.windows.getCurrent({ populate: true }),
  ownTabs: await chrome.tabs.query({ currentWindow: true }),
  hasNode: typeof require !== "undefined" || typeof process !== "undefined",
  hasPaseoBridge: typeof window.paseoDesktop !== "undefined",
}))();
