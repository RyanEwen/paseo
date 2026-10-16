const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { appendFileSync } = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { BrowserWindow, session, webContents, screen, nativeImage } = require("electron");
const { NativeBrowserViewOwner } = require("../dist/features/browser-views/owner.js");
const { getNativeBrowserSurface } = require("../dist/features/browser-views/surfaces.js");
const { BrowserKeyboard } = require("../dist/features/browser-keyboard/index.js");
const { getPaseoBrowserWebviewRegistry } = require("../dist/features/browser-webviews/index.js");

/** Create persistent-profile fixture pages through the actual production owner.
 * Identity is admitted before page navigation, including document-start senders.
 * Host shutdown owns cleanup; no renderer registration or live profile is used.
 */
async function createNativeBrowserProfileFixture(host, profile, sourceUrl, options = {}) {
  const {
    registerBrowserWebviewNavigationGuards,
  } = require("../dist/features/browser-webviews/index.js");
  const keyboard = new BrowserKeyboard(getPaseoBrowserWebviewRegistry());
  const owner = new NativeBrowserViewOwner({
    profile: () => profile,
    preloadPath: () =>
      path.resolve(__dirname, "../dist/features/browser-keyboard/guest-preload.js"),
    prepare(contents, window) {
      keyboard.attach({ contents, hostContents: window.webContents });
      registerBrowserWebviewNavigationGuards(contents, { profileSession: profile });
    },
  });
  owner.registerHost(host);
  const identities = [];
  const guests = [];
  try {
    for (const browserId of options.browserIds ?? ["browser-first", "browser-second"]) {
      const identity = owner.create(host.webContents.id, {
        browserId,
        workspaceId: options.workspaceId ?? "compatibility-workspace",
        url: "about:blank",
      });
      identities.push(identity);
      const contents = webContents.fromId(identity.webContentsId);
      assert.equal(contents.session, profile);
      owner.present(host.webContents.id, {
        viewportMode: "fixed",
        browserId,
        visible: false,
        bounds: { x: 0, y: 0, width: 640, height: 480 },
      });
      await owner.navigate(host.webContents.id, browserId, sourceUrl);
      guests.push(contents);
    }
    return { guests, identities, nativeOwner: owner, backend: "production-native-owner" };
  } catch (error) {
    for (const identity of identities) {
      owner.close(host.webContents.id, identity.browserId);
    }
    throw error;
  }
}

/** Verify creator/profile/host identity and rejection of renderer claims for each page. */
function assertNativeBrowserProfileIdentity(fixture, profile) {
  const browserWebviews = require("../dist/features/browser-webviews/index.js");
  const registry = browserWebviews.getPaseoBrowserWebviewRegistry();
  const host = fixture.handle.win;
  for (const identity of fixture.identities) {
    const guest = webContents.fromId(identity.webContentsId);
    fixture.nativeOwner.assertTarget(host.webContents.id, identity.browserId, guest.id);
    const registration = registry.getRegistrationForWebContents(guest.id);
    assert.equal(registration?.hostWebContentsId, host.webContents.id);
    assert.equal(registration?.browserId, identity.browserId);
    assert.equal(BrowserWindow.fromWebContents(guest), host);
    assert.equal(guest.session, profile);
    assert.equal(
      browserWebviews.registerAttachedPaseoBrowser({
        browserId: identity.browserId,
        workspaceId: identity.workspaceId,
        webContentsId: guest.id,
        sender: host.webContents,
        profileSession: profile,
        findWebContents: (id) => webContents.fromId(id),
      }),
      false,
      "Renderer registration cannot claim a main-created native page",
    );
  }
}

/** Check an early native sender snapshot before selection, then query selection fresh.
 * The worker's stored response describes lookup time, not a later tab activation.
 * Identity/profile and selected state have separate assertions and flushed receipts.
 */
async function assertNativeDocumentStartTab({ popup, guest, host, profile, workspaceId, outDir }) {
  const browserWebviews = require("../dist/features/browser-webviews/index.js");
  const registry = browserWebviews.getPaseoBrowserWebviewRegistry();
  const { record, step } = createNativeFixtureDiagnostics(outDir);
  const expected = { tabId: guest.id, windowId: host.id, hostContentsId: host.webContents.id };
  const key = `earlyTab:${guest.id}`;
  const early = await step(
    "document-start:stored-tab",
    async () => {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const stored = await popup.webContents.executeJavaScript(
          `chrome.storage.local.get(${JSON.stringify(key)})`,
        );
        if (stored[key]?.tab) return stored[key].tab;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error("Document-start sender did not receive its main-owned identity");
    },
    15000,
  );
  record("document-start:identity-before-selection", "observed", {
    actual: early,
    expected,
    profileMatches: guest.session === profile,
    selectedBrowserId: registry.getActiveBrowserIdForHostWindow(host.webContents.id),
    registration: registry.getRegistrationForWebContents(guest.id),
  });
  assert.equal(guest.session, profile);
  assert.equal(early.id, expected.tabId);
  assert.equal(early.windowId, expected.windowId);

  // Use the same fixture selection operation as the legacy path. Never repair
  // native focus or reassign the already admitted native browser identity.
  browserWebviews.setWorkspaceActivePaseoBrowserId({
    hostWebContentsId: host.webContents.id,
    workspaceId,
    browserId: "browser-first",
  });
  const selected = await step(
    "document-start:fresh-selected-tab",
    () => popup.webContents.executeJavaScript(`chrome.tabs.get(${guest.id})`),
    15000,
  );
  record("document-start:identity-after-selection", "observed", {
    actual: selected,
    expected,
    profileMatches: guest.session === profile,
    selectedBrowserId: registry.getActiveBrowserIdForHostWindow(host.webContents.id),
    registration: registry.getRegistrationForWebContents(guest.id),
  });
  assert.equal(selected.id, expected.tabId);
  assert.equal(selected.windowId, expected.windowId);
  assert.equal(selected.active, true);
}

/** Share flushed causal receipts and deadlines across the native harness gates. */
function createNativeFixtureDiagnostics(outDir) {
  const stagePath = path.join(outDir, "native-stages.jsonl");
  /** Flush nonsecret causal receipts before starting a potentially stalled operation. */
  function record(stage, status, fields = {}) {
    appendFileSync(
      stagePath,
      `${JSON.stringify({ stage, status, recordedAtUtc: new Date().toISOString(), ...fields })}\n`,
    );
  }
  /** Bound fixture waits without replaying or claiming cancellation of native work.
   * Timeout tears down the entire owned fixture; it never retries an unknown outcome.
   */
  async function step(stage, operation, timeoutMs = 8000) {
    record(stage, "started", { timeoutMs });
    let timer;
    try {
      const result = await Promise.race([
        Promise.resolve().then(operation),
        new Promise((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Native fixture stage timed out: ${stage}`)),
            timeoutMs,
          );
        }),
      ]);
      record(stage, "completed");
      return result;
    } catch (error) {
      record(stage, "failed", { error: String(error) });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  return { record, step };
}

/** Observe a real WM transition after one request, without focus repair or replay.
 * Event receipts alone are insufficient: the actual native window predicate must
 * acknowledge the requested state within two seconds on the private display.
 */
async function acknowledgeNativeWindowState(host, request, predicate) {
  await new Promise((resolve, reject) => {
    const events = ["show", "hide", "minimize", "restore"];
    const cleanup = () => {
      clearTimeout(timer);
      for (const event of events) host.removeListener(event, observe);
    };
    const observe = () => {
      if (!predicate()) return;
      cleanup();
      resolve();
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Private WM did not acknowledge actual native window state"));
    }, 2000);
    for (const event of events) host.on(event, observe);
    try {
      request();
      observe();
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

/** Reject an unowned display before any presented or scale-specific fixture page. */
function admitNativeFixtureDisplay(gate) {
  assert.ok(["hidden", "minimized", "dpr15"].includes(gate));
  if (gate !== "hidden") {
    assert.equal(process.platform, "linux");
    assert.equal(process.env.PASEO_BROWSER_FIXTURE_PRIVATE_DISPLAY, "1");
    assert.match(process.env.DISPLAY ?? "", /^:[2-9]\d{4}$/);
    assert.ok(process.env.XAUTHORITY, "Owned authenticated display is required");
  }
}

/** Exercise production capture in the existing automation group with owned pages.
 * The default hidden baseline is retained. Separate admitted modes observe actual
 * private-WM minimization or a flag-based scale factor, never native Windows DPI.
 * No OS input, real workspace, third-party extension or lifecycle claim follows.
 */
async function runNativeViewFixture(outDir, { gate = "hidden" } = {}) {
  admitNativeFixtureDisplay(gate);
  const { record, step } = createNativeFixtureDiagnostics(outDir);
  record("fixture", "started", {
    platform: process.platform,
    architecture: process.arch,
    gate,
    electron: process.versions.electron,
  });
  const server = http.createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end(`<!doctype html><style>html,body{margin:0;background:#fff}
      #top,#bottom{position:fixed;left:0;right:0;height:32px}
      #top{top:0;background:rgb(17,34,51)}#bottom{bottom:0;background:rgb(68,85,102)}</style>
      <div id=top></div><input id=draft style="margin-top:60px"><div id=bottom></div>`);
  });
  let host;
  try {
    await step(
      "server-listen",
      () =>
        new Promise((resolve, reject) => {
          server.once("error", reject);
          server.listen(0, "127.0.0.1", resolve);
        }),
    );
    const serverPort = server.address().port;
    record("server-port", "listening", { host: "127.0.0.1", port: serverPort });
    const profile = session.fromPartition(`native-fixture-${randomUUID()}`);
    const keyboard = new BrowserKeyboard(getPaseoBrowserWebviewRegistry());
    const owner = new NativeBrowserViewOwner({
      profile: () => profile,
      preloadPath: () =>
        path.resolve(__dirname, "../dist/features/browser-keyboard/guest-preload.js"),
      prepare: (contents, window) =>
        keyboard.attach({ contents, hostContents: window.webContents }),
    });
    host = new BrowserWindow({ show: false, width: 320, height: 240 });
    owner.registerHost(host);
    const hostId = host.webContents.id;
    const address = `http://127.0.0.1:${server.address().port}`;
    const receipts = [];
    const viewports =
      gate === "hidden"
        ? [
            [672, 1497],
            [1008, 2246],
          ]
        : [[672, 1497]];
    for (const [index, dimensions] of viewports.entries()) {
      const browserId = `native-fixture-${index}`;
      const state = await step(`${index}:create`, () =>
        owner.create(hostId, {
          browserId,
          workspaceId: `workspace-${index}`,
          url: address,
        }),
      );
      const contents = webContents.fromId(state.webContentsId);
      record(`${index}:admission`, "observed", {
        type: contents.getType(),
        profileMatches: contents.session === profile,
        hostId,
        contentsId: contents.id,
        hostDestroyed: host.isDestroyed(),
        contentsDestroyed: contents.isDestroyed(),
      });
      await step(`${index}:navigate`, () =>
        owner.navigate(hostId, browserId, `${address}/loaded-${index}`),
      );
      await step(`${index}:draft`, () =>
        contents.executeJavaScript(
          "document.querySelector('#draft').value='unsaved draft';document.cookie='fixture=retained;SameSite=Lax'",
        ),
      );
      record(`${index}:resize`, "started");
      owner.present(hostId, {
        viewportMode: "fixed",
        browserId,
        visible: false,
        bounds: { x: 0, y: 0, width: dimensions[0], height: dimensions[1] },
      });
      record(`${index}:resize`, "completed");
      const nativeView = host.contentView.children.find((child) => child.webContents === contents);
      assert.ok(nativeView, "Created native view remains attached to its actual host");
      record(`${index}:native-geometry`, "observed", {
        bounds: nativeView.getBounds(),
        viewVisible: nativeView.getVisible(),
        hostBounds: host.getContentBounds(),
        hostVisible: host.isVisible(),
        hostMinimized: host.isMinimized(),
      });
      // Record pre-capture geometry without gating the production readiness path.
      // Hidden-view priming is owned by surface.capture, as in VS Code. Exact CSS
      // dimensions and fresh pixels must both pass after that call returns.
      record(
        `${index}:pre-capture-css-geometry`,
        "observed",
        await step(`${index}:pre-capture-metrics`, () =>
          contents.executeJavaScript(
            "({width:innerWidth,height:innerHeight,scale:devicePixelRatio})",
          ),
        ),
      );
      const surface = getNativeBrowserSurface(contents.id);
      assert.ok(surface);
      const phases =
        gate === "minimized" ? ["background", "minimized", "restored"] : ["background"];
      const guestZoom = contents.getZoomFactor();
      assert.equal(guestZoom, 1, "Observe the admitted guest zoom, never repair it");
      for (const [phaseIndex, phase] of phases.entries()) {
        if (phase === "minimized") {
          await step(
            "wm:show-inactive",
            () =>
              acknowledgeNativeWindowState(
                host,
                () => host.showInactive(),
                () => host.isVisible(),
              ),
            3000,
          );
          await step(
            "wm:minimize",
            () =>
              acknowledgeNativeWindowState(
                host,
                () => host.minimize(),
                () => host.isMinimized(),
              ),
            3000,
          );
        } else if (phase === "restored") {
          await step(
            "wm:restore",
            () =>
              acknowledgeNativeWindowState(
                host,
                () => host.restore(),
                () => !host.isMinimized() && host.isVisible(),
              ),
            3000,
          );
          owner.present(hostId, {
            viewportMode: "fixed",
            browserId,
            visible: true,
            bounds: { x: 0, y: 0, width: dimensions[0], height: dimensions[1] },
          });
        }
        const stateBefore = {
          hostVisible: host.isVisible(),
          hostMinimized: host.isMinimized(),
          hostFocused: host.isFocused(),
          guestFocused: contents.isFocused(),
          nativeBounds: nativeView.getBounds(),
          viewVisible: nativeView.getVisible(),
          display: screen.getDisplayMatching(host.getBounds()),
          hostZoom: host.webContents.getZoomFactor(),
          guestZoom: contents.getZoomFactor(),
        };
        record(`${index}:${phase}:native-state-before`, "observed", stateBefore);
        if (gate !== "hidden") assert.equal(stateBefore.hostZoom, 1);
        if (phase === "minimized") assert.equal(stateBefore.hostMinimized, true);
        if (phase === "restored") assert.equal(stateBefore.hostMinimized, false);
        const color = [(68 + phaseIndex * 37 + index * 51) % 256, 85, 102];
        const topColor = [(170 + phaseIndex * 23) % 256, 51 + index * 17, 85];
        await step(`${index}:${phase}:paint-change`, () =>
          contents.executeJavaScript(
            `document.querySelector('#bottom').style.background='rgb(${color.join(",")})';document.querySelector('#top').style.background='rgb(${topColor.join(",")})'`,
          ),
        );
        const image = await step(
          `${index}:${phase}:capture`,
          () => surface.capture(AbortSignal.timeout(10000)),
          12000,
        );
        const png = image.toPNG();
        await fs.writeFile(path.join(outDir, `native-${index}-${phase}.png`), png);
        // Decode the returned PNG as physical pixels. NativeImage.getSize() may
        // describe a DIP representation; no resize or resampling is performed.
        const decoded = nativeImage.createFromBuffer(png);
        const metrics = await step(`${index}:${phase}:metrics`, () =>
          contents.executeJavaScript(
            "({width:innerWidth,height:innerHeight,scale:devicePixelRatio,draft:document.querySelector('#draft').value,cookie:document.cookie})",
          ),
        );
        record(`${index}:${phase}:post-capture-css-geometry`, "observed", metrics);
        const size = decoded.getSize();
        record(`${index}:${phase}:physical-image`, "observed", {
          pngSize: size,
          nativeImageSize: image.getSize(),
          representations: image.getScaleFactors(),
        });
        assert.equal(metrics.width, dimensions[0]);
        assert.equal(metrics.height, dimensions[1]);
        assert.equal(metrics.draft, "unsaved draft");
        assert.match(metrics.cookie, /fixture=retained/);
        if (gate === "dpr15") {
          assert.equal(stateBefore.display.scaleFactor, 1.5);
          assert.equal(metrics.scale, 1.5);
        }
        assert.equal(stateBefore.nativeBounds.width, dimensions[0]);
        assert.equal(stateBefore.nativeBounds.height, dimensions[1]);
        assert.deepEqual(nativeView.getBounds(), stateBefore.nativeBounds);
        assert.equal(nativeView.getVisible(), phase === "restored");
        assert.equal(host.isVisible(), stateBefore.hostVisible);
        assert.equal(host.isMinimized(), stateBefore.hostMinimized);
        assert.equal(contents.getZoomFactor(), guestZoom);
        assert.equal(contents.session, profile);
        assert.equal(owner.snapshot(hostId, browserId).webContentsId, state.webContentsId);
        assert.equal(size.width, Math.round(metrics.width * metrics.scale));
        assert.equal(size.height, Math.round(metrics.height * metrics.scale));
        const bitmap = decoded.toBitmap();
        const pixel = (y) => {
          const offset = (y * size.width + Math.floor(size.width / 2)) * 4;
          return [bitmap[offset + 2], bitmap[offset + 1], bitmap[offset]];
        };
        assert.deepEqual(pixel(Math.round(8 * metrics.scale)), topColor);
        assert.deepEqual(pixel(size.height - Math.round(8 * metrics.scale)), color);
        assert.equal(host.isFocused(), stateBefore.hostFocused, "Capture never changes host focus");
        assert.equal(
          contents.isFocused(),
          stateBefore.guestFocused,
          "Capture never changes guest focus",
        );
        if (phase !== "restored") assert.equal(owner.focus(hostId, browserId), false);
        receipts.push({
          browserId,
          phase,
          metrics,
          size,
          stateBefore,
          hostFocused: host.isFocused(),
          hostVisible: host.isVisible(),
          hostMinimized: host.isMinimized(),
        });
      }
      owner.close(hostId, browserId);
      assert.equal(getNativeBrowserSurface(state.webContentsId), undefined);
    }
    return {
      backend: "production-native-owner",
      platform: process.platform,
      architecture: process.arch,
      versions: process.versions,
      gate,
      receipts,
      scaleScope:
        gate === "dpr15"
          ? "Electron force-device-scale-factor fixture, not native Windows 150%"
          : "Observed private X11 display",
      unverified: [
        ...(gate === "minimized" ? [] : ["Actual minimized host"]),
        "Native Windows/macOS scale and minimized lifecycle",
        "OS keyboard input and external application focus",
        "real inactive workspace and overlays",
        "reload and profile restart",
        "extensions",
        "crash recovery",
        "hardware GPU composition",
      ],
    };
  } finally {
    record("cleanup", "started");
    if (host && !host.isDestroyed()) host.destroy();
    const port = server.address()?.port;
    server.closeAllConnections();
    await step("server-close", () => new Promise((resolve) => server.close(resolve)), 2000);
    record("server-port", "closed", { host: "127.0.0.1", port });
    record("cleanup", "completed");
  }
}

module.exports = {
  runNativeViewFixture,
  createNativeFixtureDiagnostics,
  createNativeBrowserProfileFixture,
  assertNativeBrowserProfileIdentity,
  assertNativeDocumentStartTab,
};
