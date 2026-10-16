// The real extension document must have its Chrome APIs without Paseo or Node access.
window.popupReady = chrome.storage.local.get("profileValue").then((stored) => {
  const state = {
    extensionId: chrome.runtime.id,
    profileValue: stored.profileValue ?? null,
    hasNode: typeof process !== "undefined" || typeof require !== "undefined",
    hasPaseoBridge: typeof window.paseoDesktop !== "undefined",
  };
  document.getElementById("status").textContent = "Extension popup ready";
  return state;
});
