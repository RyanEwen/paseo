chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message.type === "paseo-compatibility-content") {
    reply({ href: location.href, senderId: sender.id });
  }
});
// The background must resolve this native sender's tab while the guest is still starting.
if (window.top === window) {
  void chrome.runtime.sendMessage({ type: "paseo-document-start-tab" });
}
