const { BrowserWindow } = require("electron");

/** Exercise real extension-created document windows independently of the toolbar action popup. */
async function assertExtensionDocumentPopout({
  profile,
  toolbarPopup,
  owner,
  extension,
  allowFocus = false,
}) {
  const foreignExtension = profile.extensions
    .getAllExtensions()
    .find((item) => item.id !== extension.id);
  if (!foreignExtension) {
    throw new Error("The popout permission fixture requires another installed extension.");
  }
  const url = `chrome-extension://${extension.id}/popout.html?paseo-popout=unlock&route=%2Flogin`;
  const sentinel = "dummy-popout-profile-sentinel";
  let created;
  let native;

  async function invoke(expression) {
    return toolbarPopup.webContents.executeJavaScript(expression);
  }

  async function expectRejected(inputUrl) {
    const rejected = await invoke(`(async () => {
      try {
        const result = await chrome.windows.create({url: ${JSON.stringify(inputUrl)}, type: "popup", focused: false});
        if (result?.id !== undefined) await chrome.windows.remove(result.id);
        return false;
      } catch { return true; }
    })()`);
    if (!rejected) {
      throw new Error(
        "An extension popout accepted an origin outside its own installed extension.",
      );
    }
  }

  try {
    await invoke(`chrome.storage.local.set({popoutProfileSentinel: ${JSON.stringify(sentinel)}})`);
    created = await invoke(
      `chrome.windows.create({url: ${JSON.stringify(url)}, type: "popup", width: 480, height: 630, focused: false})`,
    );
    native = BrowserWindow.fromId(created.id);
    if (
      !native ||
      native === toolbarPopup ||
      native === owner ||
      native.webContents.session !== profile
    ) {
      throw new Error(
        "An extension-created document window did not retain its distinct native/profile identity.",
      );
    }
    const bounds = native.getBounds();
    if (bounds.width !== 480 || bounds.height !== 630 || native.webContents.getURL() !== url) {
      throw new Error("The popout did not preserve its requested geometry and exact route query.");
    }
    const state = await native.webContents.executeJavaScript("window.paseoExtensionPopoutState");
    assertDocumentIdentity(state, { extension, native, created, url, sentinel });
    const populated = await invoke(`chrome.windows.get(${created.id}, {populate: true})`);
    const popupWindows = await invoke(
      'chrome.windows.getAll({windowTypes: ["popup"], populate: true})',
    );
    const popupTabs = await invoke('chrome.tabs.query({windowType: "popup"})');
    assertEnumeration({ populated, popupWindows, popupTabs, native, created, toolbarPopup, owner });
    const matching = await invoke(
      `chrome.tabs.query({windowType: "popup", url: ${JSON.stringify(`chrome-extension://${extension.id}/popout.html*`)}})`,
    );
    if (matching.length !== 1 || matching[0].windowId !== created.id || matching[0].url !== url) {
      throw new Error(
        "The extension popup URL pattern did not identify its existing document for reuse.",
      );
    }
    const previousCount = BrowserWindow.getAllWindows().length;
    const updated = await invoke(`chrome.windows.update(${created.id}, {focused: ${allowFocus}})`);
    assertReusedPopout({ updated, created, native, previousCount, allowFocus });
    await expectRejected(`chrome-extension://${foreignExtension.id}/popup.html`);
    await expectRejected("https://example.invalid/paseo-popout-denied");
    await invoke(`chrome.windows.remove(${created.id})`);
    if (!native.isDestroyed() || toolbarPopup.isDestroyed() || owner.isDestroyed()) {
      throw new Error("Removing the extension document did not destroy exactly its popout.");
    }
    const remaining = await invoke('chrome.tabs.query({windowType: "popup"})');
    if (remaining.some((tab) => tab.windowId === created.id)) {
      throw new Error("The closed extension popout retained a stale Chrome tab identity.");
    }
  } finally {
    if (native && !native.isDestroyed()) {
      native.destroy();
    }
    await invoke('chrome.storage.local.remove("popoutProfileSentinel")');
  }
}

module.exports = { assertExtensionDocumentPopout };

/** Check the document's actual native APIs without logging page or account contents. */
function assertDocumentIdentity(state, { extension, native, created, url, sentinel }) {
  if (
    state.extensionId !== extension.id ||
    state.href !== url ||
    state.popoutProfileSentinel !== sentinel ||
    state.hasNode ||
    state.hasPaseoBridge ||
    state.currentWindow.id !== created.id ||
    state.currentWindow.type !== "popup" ||
    state.currentTab?.id !== native.webContents.id ||
    state.currentTab.windowId !== created.id ||
    state.tabs.length !== 1 ||
    state.tabs[0].id !== native.webContents.id
  ) {
    throw new Error(
      "The real extension document did not receive its own popup tab identity and safe native APIs.",
    );
  }
}

/** Enumeration must expose document popouts as tabs while excluding toolbar-only action windows. */
function assertEnumeration({
  populated,
  popupWindows,
  popupTabs,
  native,
  created,
  toolbarPopup,
  owner,
}) {
  if (
    populated.tabs.length !== 1 ||
    populated.tabs[0].id !== native.webContents.id ||
    !popupWindows.some((item) => item.id === created.id && item.type === "popup") ||
    popupWindows.some((item) => item.id === toolbarPopup.id || item.id === owner.id) ||
    !popupTabs.some((item) => item.id === native.webContents.id && item.windowId === created.id)
  ) {
    throw new Error(
      "Extension window/tab enumeration confused document popouts with toolbar actions or normal browser tabs.",
    );
  }
}

/** Updating focus must retain the existing native document rather than opening a second window. */
function assertReusedPopout({ updated, created, native, previousCount, allowFocus }) {
  if (
    updated.id !== created.id ||
    BrowserWindow.fromId(created.id) !== native ||
    BrowserWindow.getAllWindows().length !== previousCount ||
    (allowFocus && !native.isFocused())
  ) {
    throw new Error("Updating the existing popout did not reuse and focus the same native window.");
  }
}
