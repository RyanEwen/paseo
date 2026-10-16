window.publicFixtureReady = (async () => {
  const marker = "public-frame-native-storage";
  await chrome.storage.local.set({ publicFrameMarker: marker });
  return {
    extensionId: chrome.runtime.id,
    marker,
    hasNode: typeof require === "function" || typeof process === "object",
    hasPaseoBridge: Boolean(window.paseoDesktop),
  };
})();
