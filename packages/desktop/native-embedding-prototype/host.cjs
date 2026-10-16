/** Disposable Electron host with a separately owned Chromium native X11 child.
 * Captures are evidence only; the host UI never receives or displays them.
 */
const { app, BrowserWindow, nativeImage } = require("electron");
const { spawn, execFileSync } = require("node:child_process");
const { createServer } = require("node:http");
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const assert = require("node:assert/strict");
const { CdpPipe } = require(process.env.PASEO_CDP_PIPE_MODULE);
const out = process.env.PASEO_EMBED_OUT;
if (process.platform !== "linux" || process.env.PASEO_BROWSER_FIXTURE_PRIVATE_DISPLAY !== "1") {
  throw new Error("Only an isolated private Linux X11 display is allowed");
}
const ownedProfiles = [mkdtempSync(join(tmpdir(), "paseo-embed-host-"))];
app.setPath("userData", ownedProfiles[0]);
let host, browser, cdp, server;
const rows = [];
const native = (operation, ...args) =>
  JSON.parse(
    execFileSync(process.env.PASEO_X11_BRIDGE, [operation, ...args.map(String)], {
      encoding: "utf8",
    }),
  );
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Await a bounded predicate without replaying browser mutations. */
async function until(check) {
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await wait(30);
  }
  throw new Error("Fixture condition deadline");
}
/** Evaluate on an explicitly addressed target, preserving the independent browser identity. */
async function evaluate(sessionId, expression) {
  const result = await cdp.send(
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true },
    { sessionId, timeoutMs: 5000 },
  );
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
/** Decode screenshots and assert fresh viewport-edge markers, rather than dimensions alone. */
async function capture(sessionId, name, color, width = 672, height = 1497) {
  await evaluate(
    sessionId,
    `document.querySelector('#top').style.background='rgb(${color},34,51)';document.querySelector('#bottom').style.background='rgb(204,85,${color})';document.querySelector('#bottom').style.top='${height - 47}px'`,
  );
  const result = await cdp.send(
    "Page.captureScreenshot",
    { format: "png", captureBeyondViewport: false },
    { sessionId, timeoutMs: 5000 },
  );
  const png = Buffer.from(result.data, "base64");
  writeFileSync(join(out, `${name}.png`), png);
  const image = nativeImage.createFromBuffer(png),
    size = image.getSize(),
    pixels = image.toBitmap();
  const sample = (x, y) => [
    ...pixels.subarray((y * size.width + x) * 4, (y * size.width + x) * 4 + 4),
  ];
  const top = sample(20, 20),
    bottom = sample(20, size.height - 20);
  const receipt = {
    name,
    size,
    top,
    bottom,
    dom: await evaluate(
      sessionId,
      "({width:innerWidth,height:innerHeight,draft:draft.value,visibility:document.visibilityState,events:window.events})",
    ),
  };
  rows.push(receipt);
  assert.deepEqual(size, { width: Math.ceil(width * 1.5), height: Math.ceil(height * 1.5) });
  assert.equal(receipt.dom.width, width);
  assert.equal(receipt.dom.height, height);
  assert.deepEqual(top, [51, 34, color, 255]);
  assert.deepEqual(bottom, [color, 85, 204, 255]);
  return receipt;
}
/** Launch a fresh exclusive diagnostic profile. No debug TCP port or sandbox bypass. */
async function launch(url, profile) {
  browser = spawn(
    process.env.PASEO_CHROMIUM_EXECUTABLE,
    [
      `--user-data-dir=${profile}`,
      "--remote-debugging-pipe",
      "--no-first-run",
      "--no-default-browser-check",
      "--ozone-platform=x11",
      "--force-device-scale-factor=1.5",
      `--app=${url}`,
    ],
    { stdio: ["ignore", "ignore", "inherit", "pipe", "pipe"] },
  );
  cdp = new CdpPipe(browser.stdio[3], browser.stdio[4]);
  browser.once("error", (error) => cdp.close(error));
  const version = await cdp.send("Browser.getVersion", {}, { timeoutMs: 10000 });
  const target = await until(async () =>
    (await cdp.send("Target.getTargets")).targetInfos.find(
      (item) => item.type === "page" && item.url === url,
    ),
  );
  const { sessionId } = await cdp.send("Target.attachToTarget", {
    targetId: target.targetId,
    flatten: true,
  });
  await cdp.send("Runtime.enable", {}, { sessionId });
  await until(
    async () =>
      await evaluate(
        sessionId,
        'document.readyState === "complete" && !!document.querySelector("#top")',
      ),
  );
  return { sessionId, targetId: target.targetId, version };
}
/** Close the private owned browser, with a deadline and no surviving pipe operation. */
async function stopBrowser() {
  if (!browser) return;
  const child = browser;
  browser = null;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  try {
    await cdp.send("Browser.close", {}, { timeoutMs: 1000 });
  } catch {}
  await Promise.race([exited, wait(2000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await exited;
  }
  cdp.close();
}
async function main() {
  await app.whenReady();
  mkdirSync(out, { recursive: true });
  server = createServer((req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(
      `<style>body{margin:0;background:white}#top{position:absolute;top:0;width:100%;height:40px;background:rgb(17,34,51)}#bottom{position:absolute;top:1450px;width:100%;height:47px;background:rgb(204,85,17)}</style><div id="top"></div><div id="bottom"></div><input id="draft" style="position:absolute;top:90px"><script>window.events=[];draft.addEventListener('input',e=>events.push({trusted:e.isTrusted,value:draft.value}));</script>`,
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  host = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    webPreferences: { sandbox: true },
  });
  await host.loadURL(
    'data:text/html,<input id="composer" autofocus style="width:500px"><div>Native Chromium surface below</div>',
  );
  host.show();
  host.focus();
  host.webContents.focus();
  await host.webContents.executeJavaScript("composer.focus()");
  await wait(100);
  execFileSync("python3", [process.env.PASEO_KEYS, "a"]);
  await until(async () => await host.webContents.executeJavaScript("composer.value==='a'"));
  rows.push({ name: "native-key-baseline", hostValue: "a" });
  const hostId = host.getNativeWindowHandle().readUInt32LE();
  const profile = mkdtempSync(join(tmpdir(), "paseo-embed-chromium-"));
  ownedProfiles.push(profile);
  const first = await launch(url, profile);
  rows.push({
    name: "browser-runtime",
    version: first.version,
    system: await cdp.send("SystemInfo.getInfo"),
  });
  const windowId = await until(() => native("find", browser.pid));
  native("withdraw", windowId);
  await until(() => {
    const state = native("inspect", windowId);
    return state.parent === state.root && state.mapState === 0;
  });
  const attached = native("attach", windowId, hostId, 1008, 2246, 1);
  assert.equal(attached.parent, hostId);
  host.focus();
  host.webContents.focus();
  await host.webContents.executeJavaScript("composer.focus()");
  await wait(100);

  const focusBefore = native("inspect", hostId).focus;
  await cdp.send(
    "Emulation.setDeviceMetricsOverride",
    { width: 672, height: 1497, deviceScaleFactor: 1.5, mobile: false },
    { sessionId: first.sessionId },
  );
  await capture(first.sessionId, "embedded-visible", 21);
  const painted = await until(() => {
    const state = native("inspect", windowId);
    return state.topPixel === 0x152233 && state;
  });
  rows.push({ name: "native-child-pixels", ...painted });
  await cdp.send(
    "Input.dispatchMouseEvent",
    { type: "mousePressed", x: 20, y: 100, button: "left", clickCount: 1 },
    { sessionId: first.sessionId },
  );
  await cdp.send(
    "Input.dispatchMouseEvent",
    { type: "mouseReleased", x: 20, y: 100, button: "left", clickCount: 1 },
    { sessionId: first.sessionId },
  );
  await cdp.send("Input.insertText", { text: "retained draft" }, { sessionId: first.sessionId });
  assert.equal(await evaluate(first.sessionId, "draft.value"), "retained draft");
  rows.push({
    name: "automation-focus",
    before: focusBefore,
    after: native("inspect", hostId).focus,
    host: await host.webContents.executeJavaScript(
      "({active:document.activeElement.id,value:composer.value})",
    ),
  });
  execFileSync("python3", [process.env.PASEO_KEYS, "b"]);
  await wait(150);
  const routing = {
    name: "native-key-routing",
    hostValue: await host.webContents.executeJavaScript("composer.value"),
    guestValue: await evaluate(first.sessionId, "draft.value"),
  };
  routing.passed = routing.hostValue === "ab" && routing.guestValue === "retained draft";
  rows.push(routing);
  native("hide", windowId);
  await capture(first.sessionId, "inactive-pane", 22);
  assert.equal(await evaluate(first.sessionId, "draft.value"), routing.guestValue);
  const { targetId: backgroundId } = await cdp.send("Target.createTarget", {
    url,
    background: true,
  });
  const { sessionId: backgroundSession } = await cdp.send("Target.attachToTarget", {
    targetId: backgroundId,
    flatten: true,
  });
  await until(
    async () =>
      await evaluate(
        backgroundSession,
        'document.readyState==="complete" && !!document.querySelector("#top")',
      ),
  );
  await cdp.send(
    "Emulation.setDeviceMetricsOverride",
    { width: 672, height: 1497, deviceScaleFactor: 1.5, mobile: false },
    { sessionId: backgroundSession },
  );
  rows.push({ name: "background-native-windows-hidden", ...native("hide-process", browser.pid) });
  await capture(backgroundSession, "new-background-tab", 23);
  await cdp.send("Page.navigate", { url: url + "navigated" }, { sessionId: backgroundSession });
  await until(
    async () =>
      await evaluate(
        backgroundSession,
        'location.pathname==="/navigated" && document.readyState==="complete" && !!document.querySelector("#top")',
      ),
  );
  await capture(backgroundSession, "background-navigation", 24);
  native("resize", windowId, 1100, 2400);
  await cdp.send(
    "Emulation.setDeviceMetricsOverride",
    { width: 720, height: 1601, deviceScaleFactor: 1.5, mobile: false },
    { sessionId: first.sessionId },
  );
  await capture(first.sessionId, "hidden-resize", 25, 720, 1601);
  host.hide();
  await capture(first.sessionId, "hidden-host", 26, 720, 1601);
  host.showInactive();
  host.minimize();
  await until(() => host.isMinimized());
  rows.push({
    name: "host-window-state",
    minimized: host.isMinimized(),
    visible: host.isVisible(),
  });
  await capture(first.sessionId, "minimized-host", 27, 720, 1601);
  await evaluate(backgroundSession, "window.fixtureDocumentToken='before-reload'");
  await cdp.send("Page.reload", {}, { sessionId: backgroundSession });
  await until(
    async () =>
      await evaluate(
        backgroundSession,
        'window.fixtureDocumentToken===undefined && document.readyState==="complete" && !!document.querySelector("#top")',
      ),
  );
  await capture(backgroundSession, "minimized-background-reload", 28);
  await evaluate(
    first.sessionId,
    "document.cookie='fixture=preserved; path=/; max-age=3600';localStorage.setItem('fixture','preserved')",
  );
  await stopBrowser();
  const reopened = await launch(url, profile);
  const state = await evaluate(
    reopened.sessionId,
    '({cookie:document.cookie,local:localStorage.getItem("fixture")})',
  );
  assert.equal(state.cookie, "fixture=preserved");
  assert.equal(state.local, "preserved");
  rows.push({ name: "profile-reopen", state, version: reopened.version });
  await stopBrowser();
}
const deadline = setTimeout(() => {
  if (browser) browser.kill("SIGKILL");
  app.exit(2);
}, 60000);
main()
  .catch((error) => {
    rows.push({ error: error.stack });
    process.exitCode = 1;
  })
  .finally(async () => {
    await stopBrowser();
    if (host && !host.isDestroyed()) host.destroy();
    if (server) await new Promise((resolve) => server.close(resolve));
    writeFileSync(
      join(out, "results.json"),
      JSON.stringify(
        {
          platform: process.platform,
          architecture: process.arch,
          electron: process.versions.electron,
          executionComplete: !rows.some((row) => row.error),
          inputContainmentPassed: rows.some(
            (row) => row.name === "native-key-routing" && row.passed,
          ),
          rows,
        },
        null,
        2,
      ),
    );
    for (const profile of ownedProfiles) rmSync(profile, { recursive: true, force: true });
    clearTimeout(deadline);
    app.exit(process.exitCode || 0);
  });
