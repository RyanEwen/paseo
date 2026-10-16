const assert = require("node:assert/strict");
const path = require("node:path");
const { BrowserWindow } = require("electron");
const { openBrowserExtensionPopup } = require("../dist/features/browser-extensions/actions.js");

/** Required storage alone must support owned extension windows while normal guest metadata remains permission-redacted. */
async function assertGenericExtensionWindows({
  profile,
  root,
  runtime,
  owner,
  guest,
  referencePopup,
}) {
  await referencePopup.webContents.executeJavaScript(
    "window.paseoBeforeGenericActivation = {tabs: chrome.tabs, windows: chrome.windows, storage: chrome.storage}; true",
  );
  const extension = await profile.extensions.loadExtension(
    path.join(root, "generic-window-extension"),
  );
  const baseline = new BrowserWindow({
    show: false,
    webPreferences: {
      session: profile,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const defaultBounds = baseline.getBounds();
  baseline.destroy();
  let toolbar;
  let document;
  try {
    toolbar = await openBrowserExtensionPopup({
      owner,
      profile,
      extension,
      show: false,
      onCreated: (window) => runtime.registerPopup(window.webContents, guest),
    });
    const url = `chrome-extension://${extension.id}/document.html`;
    const created = await toolbar.webContents.executeJavaScript(
      `chrome.windows.create({type:"popup", url:${JSON.stringify(url)}, focused:false})`,
    );
    document = BrowserWindow.fromId(created.id);
    assert.ok(document, "The storage-only extension must create its own actual document window.");
    const bounds = document.getBounds();
    assert.equal(
      bounds.width,
      defaultBounds.width,
      "Omitted width must retain Electron's native default.",
    );
    assert.equal(
      bounds.height,
      defaultBounds.height,
      "Omitted height must retain Electron's native default.",
    );
    const state = await document.webContents.executeJavaScript("window.paseoGenericDocumentState");
    assert.equal(state.tab.id, document.webContents.id);
    assert.equal(state.tab.url, url);
    assert.equal(state.tab.title, "Generic extension document fixture");
    assert.equal(state.window.id, document.id);
    assert.equal(state.window.type, "popup");
    assert.equal(state.window.tabs[0].url, url);
    assert.equal(state.ownTabs.length, 1);
    assert.equal(state.ownTabs[0].id, document.webContents.id);
    assert.equal(state.hasNode, false);
    assert.equal(state.hasPaseoBridge, false);

    const metadata = await toolbar.webContents.executeJavaScript(`(async () => ({
      guest: await chrome.tabs.get(${guest.id}),
      normalTabs: await chrome.tabs.query({windowType:"normal"}),
      window: await chrome.windows.get(${owner.id}, {populate:true}),
      ownDocument: await chrome.tabs.get(${document.webContents.id}),
      ownQuery: await chrome.tabs.query({windowType:"popup", url:${JSON.stringify(url)}}),
      stable: chrome.tabs === window.paseoGenericNamespaces.tabs && chrome.windows === window.paseoGenericNamespaces.windows && chrome.storage === window.paseoGenericNamespaces.storage
    }))()`);
    assert.equal(metadata.guest.id, guest.id);
    assert.equal(metadata.ownDocument.url, url);
    assert.equal(metadata.ownDocument.title, "Generic extension document fixture");
    assert.equal(metadata.ownQuery.length, 1);
    assert.equal(metadata.ownQuery[0].id, document.webContents.id);
    assert.equal(metadata.stable, true);
    assert.ok(metadata.normalTabs.some((tab) => tab.id === guest.id));
    assert.ok(metadata.window.tabs.some((tab) => tab.id === guest.id));
    assertRedactedTab(metadata.guest);
    metadata.normalTabs.forEach(assertRedactedTab);
    metadata.window.tabs.forEach(assertRedactedTab);

    const existingStable = await referencePopup.webContents.executeJavaScript(
      "chrome.tabs === window.paseoBeforeGenericActivation.tabs && chrome.windows === window.paseoBeforeGenericActivation.windows && chrome.storage === window.paseoBeforeGenericActivation.storage",
    );
    assert.equal(
      existingStable,
      true,
      "Activating a storage-only extension must not replace another extension's Chrome API namespaces.",
    );
    await toolbar.webContents.executeJavaScript(`chrome.windows.remove(${document.id})`);
    assert.equal(document.isDestroyed(), true);
    assert.equal(toolbar.isDestroyed(), false);
    const stable = await toolbar.webContents.executeJavaScript(
      "chrome.tabs === window.paseoGenericNamespaces.tabs && chrome.windows === window.paseoGenericNamespaces.windows && chrome.storage === window.paseoGenericNamespaces.storage",
    );
    assert.equal(
      stable,
      true,
      "Opening and closing a document must not replace existing Chrome API namespaces.",
    );
  } finally {
    if (document && !document.isDestroyed()) {
      document.destroy();
    }
    if (toolbar && !toolbar.isDestroyed()) {
      toolbar.destroy();
    }
    profile.extensions.removeExtension(extension.id);
  }
}

/** Permission-redacted structural metadata may retain identity but must omit protected properties entirely. */
function assertRedactedTab(tab) {
  assert.equal(
    Object.hasOwn(tab, "url"),
    false,
    "A normal guest URL requires tabs or matching host access.",
  );
  assert.equal(
    Object.hasOwn(tab, "title"),
    false,
    "A normal guest title requires tabs or matching host access.",
  );
}

module.exports = { assertGenericExtensionWindows };
