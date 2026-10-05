chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message.type === "paseo-compatibility-content") {
    reply({ href: location.href, senderId: sender.id });
  }
});
