const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const { WebSocketServer } = require("ws");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Verify real traffic extends native worker idle, while an open inactive socket and synthetic events do not. */
async function assertExtensionWorkerActivity({ profile, root, outputDir }) {
  const server = http.createServer();
  const sockets = new WebSocketServer({ server });
  const connections = new Map();
  const extensions = new Map();
  const inboundTimers = new Set();
  const failures = [];
  sockets.on("connection", (socket) => {
    socket.once("message", (data) => {
      const { mode, invariants } = JSON.parse(data.toString());
      if (Object.values(invariants).some((value) => value !== true)) {
        failures.push(`Native WebSocket invariants failed: ${JSON.stringify(invariants)}`);
      }
      const state = { socket, messages: 0, closed: false };
      connections.set(mode, state);
      socket.on("message", () => state.messages++);
      socket.on("close", () => {
        state.closed = true;
      });
      if (mode === "inbound") {
        const timer = setInterval(() => {
          if (socket.readyState === socket.OPEN) {
            socket.send("inbound tick");
            state.messages++;
          }
        }, 10000);
        inboundTimers.add(timer);
      }
    });
  });

  function running(id) {
    return Object.values(profile.serviceWorkers.getAllRunning()).some(
      (worker) => worker.scope === `chrome-extension://${id}/`,
    );
  }

  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    for (const mode of ["inbound", "outbound", "idle"]) {
      const extensionPath = path.join(outputDir, `worker-activity-${mode}`);
      await fs.mkdir(extensionPath, { recursive: true });
      for (const file of ["manifest.json", "background.js"]) {
        await fs.copyFile(
          path.join(root, "worker-activity-extension", file),
          path.join(extensionPath, file),
        );
      }
      await fs.writeFile(
        path.join(extensionPath, "config.js"),
        `const fixtureSocketUrl = ${JSON.stringify(`ws://127.0.0.1:${server.address().port}/`)};\nconst fixtureSocketMode = ${JSON.stringify(mode)};\n`,
      );
      const extension = await profile.extensions.loadExtension(extensionPath);
      extensions.set(mode, extension.id);
    }

    const readyDeadline = Date.now() + 15000;
    while (connections.size !== 3) {
      if (Date.now() > readyDeadline) {
        throw new Error("WebSocket worker fixtures did not connect.");
      }
      await delay(50);
    }
    await delay(75000);
    if (failures.length) {
      throw new Error(failures.join("; "));
    }
    for (const mode of ["inbound", "outbound"]) {
      const state = connections.get(mode);
      if (!running(extensions.get(mode)) || state.closed || state.messages < 7) {
        throw new Error(`${mode} WebSocket traffic did not preserve the worker for 75 seconds.`);
      }
    }
    if (running(extensions.get("idle")) || !connections.get("idle").closed) {
      throw new Error("An inactive open WebSocket incorrectly preserved its worker.");
    }

    for (const timer of inboundTimers) {
      clearInterval(timer);
    }
    for (const socket of sockets.clients) {
      socket.close();
    }
    await delay(35000);
    for (const id of extensions.values()) {
      if (running(id)) {
        throw new Error("A WebSocket worker remained alive 35 seconds after traffic stopped.");
      }
    }
  } finally {
    for (const timer of inboundTimers) {
      clearInterval(timer);
    }
    for (const id of extensions.values()) {
      profile.extensions.removeExtension(id);
    }
    for (const socket of sockets.clients) {
      socket.terminate();
    }
    await new Promise((resolve) => sockets.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  }
}

module.exports = { assertExtensionWorkerActivity };
