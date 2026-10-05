const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { BrowserWindow } = require("electron");
const browserWebviews = require("../dist/features/browser-webviews/index.js");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Real browser events must wake subscribed workers only, retaining registration through sleep. */
async function assertExtensionEventSubscriptions({
  profile,
  root,
  owner,
  firstGuest,
  secondGuest,
  stopWorker,
  outputDir,
}) {
  const extensionDirectory = path.join(outputDir, "event-subscription-extension");
  await fs.mkdir(extensionDirectory, { recursive: true });
  for (const file of ["manifest.json", "background.js", "popup.html"]) {
    await fs.copyFile(
      path.join(root, "event-subscription-extension", file),
      path.join(extensionDirectory, file),
    );
  }
  select("browser-first");
  const extension = await profile.extensions.loadExtension(extensionDirectory);
  const popup = new BrowserWindow({
    show: false,
    webPreferences: {
      session: profile,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  let unrelatedWindow;

  function running() {
    return Object.values(profile.serviceWorkers.getAllRunning()).some(
      (worker) => worker.scope === `chrome-extension://${extension.id}/`,
    );
  }

  function select(browserId) {
    browserWebviews.setWorkspaceActivePaseoBrowserId({
      hostWebContentsId: owner.webContents.id,
      workspaceId: "compatibility-workspace",
      browserId,
    });
  }

  /** Observe absence continuously; reading storage in the document does not wake its worker. */
  async function assertRemainsStopped(reason) {
    const deadline = Date.now() + 1500;
    while (Date.now() < deadline) {
      assert.equal(running(), false, reason);
      await delay(20);
    }
  }

  firstGuest.debugger.attach("1.3");
  try {
    await popup.loadURL(`chrome-extension://${extension.id}/popup.html`);
    const initial = await popup.webContents.executeJavaScript(
      'chrome.runtime.sendMessage({type:"subscription-ready"})',
    );
    assert.equal(initial.subscribed, true);
    const before = await popup.webContents.executeJavaScript(
      'chrome.storage.local.get("subscriptionWorkerStarts")',
    );
    await popup.webContents.executeJavaScript(
      'chrome.storage.local.remove("subscriptionActivation")',
    );
    await stopWorker(firstGuest, profile, extension.id);

    // Native creation/removal are real events, but this worker subscribes to neither.
    unrelatedWindow = new BrowserWindow({ show: false, webPreferences: { session: profile } });
    await unrelatedWindow.loadURL("about:blank");
    await assertRemainsStopped("An unregistered window event must not wake this idle worker.");
    unrelatedWindow.destroy();
    unrelatedWindow = null;
    await assertRemainsStopped("An unregistered window removal must not wake this idle worker.");

    select("browser-second");
    const deadline = Date.now() + 15000;
    let activation;
    while (Date.now() < deadline) {
      const stored = await popup.webContents.executeJavaScript(
        'chrome.storage.local.get("subscriptionActivation")',
      );
      activation = stored.subscriptionActivation;
      if (activation) {
        break;
      }
      await delay(20);
    }
    assert.ok(activation, "The retained subscription must wake its worker and receive activation.");
    assert.equal(activation.tabId, secondGuest.id);
    assert.equal(activation.windowId, owner.id);
    assert.equal(
      activation.throwSeen,
      true,
      "A throwing first listener must not suppress the next.",
    );
    const removed = await popup.webContents.executeJavaScript(
      'chrome.runtime.sendMessage({type:"subscription-remove"})',
    );
    assert.equal(removed.subscribed, false);
    await stopWorker(firstGuest, profile, extension.id);
    select("browser-first");
    await assertRemainsStopped("Removing the last listener must prevent a later activation wake.");
    const { subscriptionWorkerStarts } = await popup.webContents.executeJavaScript(
      'chrome.storage.local.get("subscriptionWorkerStarts")',
    );
    assert.equal(
      subscriptionWorkerStarts,
      before.subscriptionWorkerStarts + 1,
      "Only the subscribed activation may restart the worker.",
    );

    // Establish a lazy subscription, then reload the same ID without registering it.
    const resubscribed = await popup.webContents.executeJavaScript(
      'chrome.runtime.sendMessage({type:"subscription-ready"})',
    );
    assert.equal(resubscribed.subscribed, true);
    profile.extensions.removeExtension(extension.id);
    const manifestPath = path.join(extensionDirectory, "manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    manifest.description = "listeners-disabled";
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    const reloaded = await profile.extensions.loadExtension(extensionDirectory);
    assert.equal(reloaded.id, extension.id, "Reload must preserve the exact extension identity.");
    await popup.loadURL(`chrome-extension://${extension.id}/popup.html`);
    const noSubscriptions = await popup.webContents.executeJavaScript(
      'chrome.runtime.sendMessage({type:"subscription-ready"})',
    );
    assert.equal(noSubscriptions.subscribed, false);
    await stopWorker(firstGuest, profile, extension.id);
    select("browser-second");
    await assertRemainsStopped(
      "Disable/re-enable must clear the previous generation's lazy subscriptions.",
    );
  } finally {
    if (unrelatedWindow && !unrelatedWindow.isDestroyed()) {
      unrelatedWindow.destroy();
    }
    firstGuest.debugger.detach();
    popup.destroy();
    profile.extensions.removeExtension(extension.id);
    select("browser-first");
  }
}

module.exports = { assertExtensionEventSubscriptions };
