const assert = require("node:assert/strict");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { createNativeFixtureDiagnostics } = require("./native-view-fixture.js");
const { getPaseoBrowserWebviewRegistry } = require("../dist/features/browser-webviews/index.js");
const execFileAsync = promisify(execFile);

/** Install disposable receiver observations, with a painted guest hit target.
 * The marker belongs only to the repository fixture page. Events are observed,
 * never synthesized; disposal removes both the marker and listeners.
 */
async function installContextProbe(contents, guest) {
  await contents.executeJavaScript(`(() => {
    if (window.__nativeContextProbe) throw new Error('Context probe already installed');
    const events = [];
    const observe = (event) => events.push({
      type: event.type, trusted: event.isTrusted, button: event.button,
      target: event.target?.id || event.target?.tagName,
      x: event.clientX, y: event.clientY, at: performance.now()
    });
    const names = ['mousedown', 'mouseup', 'contextmenu', 'focusin'];
    for (const name of names) addEventListener(name, observe, true);
    let marker;
    if (${guest}) {
      marker = document.createElement('div');
      marker.id = 'native-context-hit';
      marker.style.cssText = 'position:fixed;left:32px;top:80px;width:160px;height:80px;background:rgb(34,153,102);z-index:2147483647';
      document.body.append(marker);
    }
    window.__nativeContextProbe = {events, dispose() {
      for (const name of names) removeEventListener(name, observe, true);
      marker?.remove();
      delete window.__nativeContextProbe;
    }};
  })()`);
}

/** Observe native ownership/visibility before changing this disposable presentation. */
function nativeContextState(host, guest, view) {
  return {
    hostWindowId: host.id,
    hostContentsId: host.webContents.id,
    guestContentsId: guest.id,
    nativeWindowId: host.getNativeWindowHandle().readUInt32LE(0),
    rootBounds: host.contentView.getBounds(),
    rootVisible: host.contentView.getVisible(),
    childBounds: view.getBounds(),
    childVisible: view.getVisible(),
    directAttached: host.contentView.children.includes(view),
    hostContentBounds: host.getContentBounds(),
    hostVisible: host.isVisible(),
    hostFocused: host.isFocused(),
    guestFocused: guest.isFocused(),
    hostZoom: host.webContents.getZoomFactor(),
    guestZoom: guest.getZoomFactor(),
  };
}

/** Admit an actually painted native target using bounded read-only observations.
 * Neither geometry nor visibility is replayed while waiting. XSync alone is not
 * Chromium readiness: both actual CSS dimensions and composed marker pixels gate input.
 */
async function observePresentedTarget({ host, guest, view, pointer, step, record }) {
  let observation;
  const deadline = Date.now() + 2000;
  await step(
    "context-menu:paint-admission",
    async () => {
      do {
        const page = await guest.executeJavaScript(`(() => {
        const r = document.querySelector('#native-context-hit').getBoundingClientRect();
        return {width:innerWidth,height:innerHeight,dpr:devicePixelRatio,
          hit:{x:r.x+r.width/2,y:r.y+r.height/2},rect:{x:r.x,y:r.y,width:r.width,height:r.height}};
      })()`);
        const native = nativeContextState(host, guest, view);
        const point = {
          x: Math.round(native.hostContentBounds.x + native.childBounds.x + page.hit.x),
          y: Math.round(native.hostContentBounds.y + native.childBounds.y + page.hit.y),
        };
        const probe = JSON.parse(
          (
            await execFileAsync(
              "python3",
              [pointer, "probe", JSON.stringify([[point.x, point.y]])],
              { timeout: 1000 },
            )
          ).stdout,
        );
        observation = { page, native, point, probe };
        if (
          page.width === native.childBounds.width &&
          page.height === native.childBounds.height &&
          page.dpr === 1 &&
          probe.pixels[0].every((v, i) => v === [34, 153, 102][i])
        )
          break;
      } while (Date.now() < deadline);
    },
    3000,
  );
  record("context-menu:paint-observation", "observed", observation);
  assert.equal(observation.page.dpr, 1);
  assert.equal(observation.page.width, observation.native.childBounds.width);
  assert.equal(observation.page.height, observation.native.childBounds.height);
  assert.deepEqual(observation.probe.pixels[0], [34, 153, 102]);
  return observation;
}

/** Request a real visible-pane context menu from the same main-created native page.
 * This is a private fixture presentation, not a background input/focus workaround.
 * One measured XTest right-click is allowed after paint admission. Prior geometry
 * and visibility are restored; natural OS mouse focus changes are recorded, not repaired.
 */
async function requestPresentedNativeContextMenu({ nativeOwner, host, guest, profile, outDir }) {
  assert.equal(process.platform, "linux");
  assert.equal(process.env.PASEO_BROWSER_FIXTURE_PRIVATE_DISPLAY, "1");
  const diagnostics = createNativeFixtureDiagnostics(outDir);
  const { step } = diagnostics;
  const phase = process.env.PASEO_CAPTURE_HARNESS_PHASE;
  assert.ok(phase === "write" || phase === "read");
  const record = (stage, status, fields = {}) =>
    diagnostics.record(stage, status, { phase, ...fields });
  const registration = getPaseoBrowserWebviewRegistry().getRegistrationForWebContents(guest.id);
  assert.equal(registration?.hostWebContentsId, host.webContents.id);
  assert.equal(guest.session, profile);
  nativeOwner.assertTarget(host.webContents.id, registration.browserId, guest.id);
  const view = host.contentView.children.find((child) => child.webContents === guest);
  assert.ok(view, "Fixture page must be the actual direct native child");
  const before = nativeContextState(host, guest, view);
  const priorPage = await guest.executeJavaScript(
    "({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})",
  );
  const nativeWindow = JSON.parse(
    (
      await execFileAsync(
        path.resolve(__dirname, "../../../.dev/x11-surface"),
        ["inspect", String(before.nativeWindowId)],
        { timeout: 2000 },
      )
    ).stdout,
  );
  record("context-menu:prior-presentation", "observed", {
    ...before,
    nativeWindow,
    priorPage,
    profileMatches: guest.session === profile,
  });
  assert.equal(before.hostVisible, true);
  assert.equal(before.hostZoom, 1);
  assert.equal(before.guestZoom, 1);
  const priorVisible = nativeOwner.snapshot(host.webContents.id, registration.browserId).visible;
  const pointer = path.join(__dirname, "private-display-pointer.py");
  let listener;
  try {
    await installContextProbe(host.webContents, false);
    await installContextProbe(guest, true);
    nativeOwner.present(host.webContents.id, {
      viewportMode: "fixed",
      browserId: registration.browserId,
      visible: true,
      bounds: before.childBounds,
    });
    const observed = await observePresentedTarget({ host, guest, view, pointer, step, record });
    await step("context-menu:painted-host", () =>
      execFileAsync(
        "python3",
        [
          pointer,
          "capture",
          String(observed.native.hostContentBounds.x),
          String(observed.native.hostContentBounds.y),
          String(observed.native.hostContentBounds.width),
          String(observed.native.hostContentBounds.height),
          path.join(outDir, `context-visible-native-${phase}.png`),
        ],
        { timeout: 3000 },
      ),
    );
    const requested = new Promise((resolve) => {
      listener = (_event, params) => resolve(params);
      guest.once("context-menu", listener);
    });
    const params = await step(
      "context-menu:one-os-request",
      async () => {
        const input = JSON.parse(
          (
            await execFileAsync(
              "python3",
              [pointer, "context-click", String(observed.point.x), String(observed.point.y)],
              { timeout: 3000 },
            )
          ).stdout,
        );
        record("context-menu:os-input", "observed", input);
        return requested;
      },
      15000,
    );
    const guestEvents = await guest.executeJavaScript("window.__nativeContextProbe.events");
    const hostEvents = await host.webContents.executeJavaScript(
      "window.__nativeContextProbe.events",
    );
    record("context-menu:real-request", "observed", {
      params: {
        x: params.x,
        y: params.y,
        pageURL: params.pageURL,
        frameURL: params.frameURL,
        mediaType: params.mediaType,
        frameId: params.frameId,
      },
      guestEvents,
      hostEvents,
      presentation: nativeContextState(host, guest, view),
      profileMatches: guest.session === profile,
    });
    assert.ok(
      guestEvents.some(
        (e) => e.type === "contextmenu" && e.trusted && e.target === "native-context-hit",
      ),
    );
    assert.ok(
      guestEvents.some(
        (e) =>
          e.type === "mousedown" &&
          e.trusted &&
          e.button === 2 &&
          e.target === "native-context-hit",
      ),
    );
    assert.equal(
      hostEvents.filter((e) => ["mousedown", "mouseup", "contextmenu"].includes(e.type)).length,
      0,
    );
    return params;
  } finally {
    if (listener) guest.removeListener("context-menu", listener);
    if (!guest.isDestroyed()) {
      const events = await guest.executeJavaScript("window.__nativeContextProbe?.events ?? []");
      record("context-menu:final-guest-events", "observed", { events });
      await guest.executeJavaScript("window.__nativeContextProbe?.dispose()");
      nativeOwner.present(host.webContents.id, {
        viewportMode: "fixed",
        browserId: registration.browserId,
        visible: priorVisible,
        bounds: before.childBounds,
      });
      const restored = nativeContextState(host, guest, view);
      record("context-menu:restored-presentation", "observed", restored);
      assert.deepEqual(restored.childBounds, before.childBounds);
      assert.equal(restored.childVisible, before.childVisible);
    }
    if (!host.webContents.isDestroyed()) {
      const events = await host.webContents.executeJavaScript(
        "window.__nativeContextProbe?.events ?? []",
      );
      record("context-menu:final-host-events", "observed", {
        events,
        hostFocused: host.isFocused(),
      });
      await host.webContents.executeJavaScript("window.__nativeContextProbe?.dispose()");
    }
  }
}

module.exports = { requestPresentedNativeContextMenu };
