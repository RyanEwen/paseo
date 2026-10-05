if (window.parent !== window) {
  window.privatePopupExecuted = true;
}
window.paseoCompatibilityResult = (async () => {
  const currentTab = await chrome.tabs.getCurrent();
  const window = await chrome.windows.getCurrent({ populate: true });
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const normalTabs = await chrome.tabs.query({
    active: true,
    currentWindow: true,
    windowType: "normal",
  });
  const popupTabs = await chrome.tabs.query({ windowType: "popup" });
  const result = await chrome.runtime.sendMessage({
    type: "paseo-compatibility-probe",
    windowId: window.id,
  });
  const optionalPermissionError = await new Promise((resolve) => {
    chrome.permissions.request({ permissions: ["nativeMessaging"] }, () =>
      resolve(chrome.runtime.lastError?.message),
    );
  });
  return { currentTab, window, tabs, normalTabs, popupTabs, result, optionalPermissionError };
})();
