importScripts("config.js");

const Constructor = WebSocket;
class FixtureSocket extends WebSocket {}
const socket = new FixtureSocket(fixtureSocketUrl);
const invariants = {
  constructorIdentity: WebSocket.prototype.constructor === WebSocket,
  subclass: socket instanceof FixtureSocket && socket instanceof WebSocket,
  constants: WebSocket.OPEN === 1 && WebSocket.CLOSED === 3,
  nativePrototype: Object.getPrototypeOf(FixtureSocket.prototype) === WebSocket.prototype,
};
try {
  Constructor("ws://127.0.0.1");
  invariants.requiresNew = false;
} catch (error) {
  invariants.requiresNew = error instanceof TypeError;
}
try {
  WebSocket.prototype.send.call({}, "invalid receiver");
  invariants.sendBranding = false;
} catch (error) {
  invariants.sendBranding = error instanceof TypeError;
}
let timer;
socket.addEventListener("open", () => {
  try {
    socket.send(Symbol("invalid payload"));
    invariants.invalidPayload = false;
  } catch (error) {
    invariants.invalidPayload = error instanceof TypeError;
  }
  socket.send(JSON.stringify({ mode: fixtureSocketMode, invariants }));
  if (fixtureSocketMode === "outbound") {
    timer = setInterval(() => socket.send("outbound tick"), 10000);
  }
  if (fixtureSocketMode === "idle") {
    const closedSocket = new WebSocket(fixtureSocketUrl);
    closedSocket.addEventListener("open", () => closedSocket.close());
    // Synthetic events and rejected native sends must not reset the worker idle deadline.
    timer = setInterval(() => {
      socket.dispatchEvent(new MessageEvent("message"));
      if (closedSocket.readyState === WebSocket.CLOSED) {
        closedSocket.send("discarded closed-socket send");
      }
      try {
        WebSocket.prototype.send.call({}, "invalid receiver");
      } catch {}
    }, 10000);
  }
});
socket.addEventListener("close", () => clearInterval(timer));
