const ready = (async () => {
  const { subscriptionWorkerStarts = 0 } = await chrome.storage.local.get(
    "subscriptionWorkerStarts",
  );
  await chrome.storage.local.set({ subscriptionWorkerStarts: subscriptionWorkerStarts + 1 });
})();
let throwSeen = false;
let pendingWrite = ready;

function throwingListener() {
  throwSeen = true;
  throw new Error("Intentional subscription fixture listener failure");
}

function survivingListener(info) {
  const previousWrite = pendingWrite;
  pendingWrite = (async () => {
    await previousWrite;
    await chrome.storage.local.set({ subscriptionActivation: { ...info, throwSeen } });
  })();
}

if (chrome.runtime.getManifest().description !== "listeners-disabled") {
  chrome.tabs.onActivated.addListener(throwingListener);
  chrome.tabs.onActivated.addListener(survivingListener);
}

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message.type !== "subscription-ready" && message.type !== "subscription-remove") {
    return;
  }
  (async () => {
    await pendingWrite;
    if (message.type === "subscription-remove") {
      chrome.tabs.onActivated.removeListener(throwingListener);
      chrome.tabs.onActivated.removeListener(survivingListener);
    }
    // Flush prior compatibility IPC before the observer stops this owned worker.
    await chrome.tabs.query({});
    respond({ subscribed: chrome.tabs.onActivated.hasListeners() });
  })().catch((error) => respond({ error: error.message }));
  return true;
});
