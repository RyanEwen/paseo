let pendingWindowEvents = Promise.resolve();
/** Preserve native window events in order so the harness can verify sleeping-worker delivery. */
async function saveWindowEvent(previous, name, detail) {
  await previous;
  const { windowEvents = [] } = await chrome.storage.local.get("windowEvents");
  await chrome.storage.local.set({ windowEvents: [...windowEvents, { name, detail }] });
}
for (const name of ["onCreated", "onRemoved", "onFocusChanged"]) {
  chrome.windows[name].addListener((detail) => {
    pendingWindowEvents = saveWindowEvent(pendingWindowEvents, name, detail);
  });
}

let pendingCommits = Promise.resolve();
/** Keep main-frame and child-frame storage writes ordered for the navigation assertion. */
async function saveCommit(previous, detail) {
  await previous;
  const { commits = [] } = await chrome.storage.local.get("commits");
  await chrome.storage.local.set({ commits: [...commits, detail] });
}

chrome.webNavigation.onCommitted.addListener((detail) => {
  pendingCommits = saveCommit(pendingCommits, detail);
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  void chrome.storage.local.set({ contextMenuClick: { info, tab } });
});
/** Await Chrome's callback while retaining create's synchronous ID for the native submenu assertion. */
function createFixtureContextMenu(properties) {
  return new Promise((resolve, reject) => {
    const id = chrome.contextMenus.create(properties, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve({ id, synchronousId: typeof id === "string" });
      }
    });
  });
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message.type === "paseo-document-start-tab") {
    void (async () => {
      const key = `earlyTab:${sender.tab.id}`;
      await chrome.storage.local.set({ [key]: { started: true } });
      const tab = await chrome.tabs.get(sender.tab.id);
      await chrome.storage.local.set({ [key]: { started: true, tab } });
      return tab;
    })().then(reply, (error) => reply({ error: String(error) }));
    return true;
  }
  if (message.type === "paseo-context-menu-register") {
    void (async () => {
      await chrome.contextMenus.removeAll();
      await chrome.storage.local.remove("contextMenuClick");
      await createFixtureContextMenu({
        id: "fixture-parent",
        title: "Fixture parent",
        contexts: ["page"],
      });
      await createFixtureContextMenu({
        id: "fixture-branch",
        title: "Fixture branch",
        parentId: "fixture-parent",
        contexts: ["page"],
      });
      return createFixtureContextMenu({
        id: "fixture-context-menu",
        title: "Fixture browser action",
        parentId: "fixture-branch",
        contexts: ["page"],
      });
    })().then(reply, (error) => reply({ error: String(error) }));
    return true;
  }
  if (message.type !== "paseo-compatibility-probe") {
    return false;
  }
  void (async () => {
    const tabs = await chrome.tabs.query({ active: true, windowId: message.windowId });
    if (tabs.length !== 1) {
      throw new Error(`Expected one selected tab, found ${tabs.length}`);
    }
    const content = await chrome.tabs.sendMessage(
      tabs[0].id,
      {
        type: "paseo-compatibility-content",
      },
      { frameId: 0 },
    );
    const tab = await chrome.tabs.get(tabs[0].id);
    const permission = await chrome.permissions.contains({ origins: ["https://example.com/*"] });
    const frame = await chrome.webNavigation.getFrame({ tabId: tabs[0].id, frameId: 0 });
    const allFrames = await new Promise((resolve) =>
      chrome.webNavigation.getAllFrames({ tabId: tabs[0].id }, resolve),
    );
    await pendingCommits;
    const { commits = [] } = await chrome.storage.local.get("commits");
    return { tabs, tab, content, permission, commits, frame, allFrames };
  })().then(reply, (error) => reply({ error: String(error) }));
  return true;
});
