window.paseoExtensionPopoutState = (async () => {
  const currentTab = await chrome.tabs.getCurrent();
  const currentWindow = await chrome.windows.getCurrent({ populate: true });
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true, windowType: "popup" });
  const { popoutProfileSentinel } = await chrome.storage.local.get("popoutProfileSentinel");
  return {
    currentTab,
    currentWindow,
    tabs,
    popoutProfileSentinel,
    href: location.href,
    extensionId: chrome.runtime.id,
    hasNode: typeof require !== "undefined" || typeof process !== "undefined",
    hasPaseoBridge: typeof window.paseoDesktop !== "undefined",
  };
})();
