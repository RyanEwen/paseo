const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { BrowserWindow, session, webContents, nativeImage } = require("electron");
const { NativeBrowserViewOwner } = require("../dist/features/browser-views/owner.js");
const { getNativeBrowserSurface } = require("../dist/features/browser-views/surfaces.js");
const { createNativeFixtureDiagnostics } = require("./native-view-fixture.js");
const execFileAsync = promisify(execFile);

/** Qualify native parent composition and real XTest hit containment at host zoom 1.
 * The host anchor is deliberately synthetic, not the React Paseo pane. Only owned
 * windows on an authenticated private display are presented or receive OS input.
 */
async function runNativeParentClipFixture(outDir, { hostZoom = 1 } = {}) {
  assert.ok(hostZoom === 1 || hostZoom === 1.25, "Only the admitted diagnostic zooms are allowed");
  const zoomDiagnostic = hostZoom === 1.25;
  assert.equal(process.env.PASEO_BROWSER_FIXTURE_PRIVATE_DISPLAY, "1");
  const { record, step } = createNativeFixtureDiagnostics(outDir);
  const server = http.createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end(`<!doctype html><style>html,body{margin:0;background:rgb(34,153,102)}
      #top,#bottom{position:fixed;left:0;right:0;height:32px}#top{top:0}#bottom{bottom:0}</style>
      <div id=top></div><div id=bottom></div><script>window.hits=[];addEventListener('click',e=>hits.push({x:e.clientX,y:e.clientY,trusted:e.isTrusted}));</script>`);
  });
  let host;
  const bounds = {
    x: 100,
    y: 100,
    width: zoomDiagnostic ? 672 : 1920,
    height: zoomDiagnostic ? 1497 : 1080,
  };
  const clip = {
    x: 200,
    y: 150,
    width: zoomDiagnostic ? 400 : 600,
    height: zoomDiagnostic ? 320 : 480,
  };
  const inHostDip = (value) => Math.round(value * hostZoom);
  const nativeViewport = { width: bounds.width, height: bounds.height };
  const pointer = path.join(__dirname, "private-display-pointer.py");
  try {
    await step(
      "server-listen",
      () =>
        new Promise((resolve, reject) => {
          server.once("error", reject);
          server.listen(0, "127.0.0.1", resolve);
        }),
    );
    record("server-port", "listening", { host: "127.0.0.1", port: server.address().port });
    host = new BrowserWindow({
      show: false,
      frame: false,
      x: 100,
      y: 100,
      width: 1000,
      height: 700,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    await step("host-load", () =>
      host.loadURL(
        "data:text/html," +
          encodeURIComponent(
            `<!doctype html><style>html,body{margin:0;width:100%;height:100%;background:rgb(153,34,85)}</style><div id=anchor style="position:absolute;left:200px;top:150px;width:${clip.width}px;height:${clip.height}px"></div><script>window.hits=[];addEventListener('click',e=>hits.push({x:e.clientX,y:e.clientY,trusted:e.isTrusted}));</script>`,
          ),
      ),
    );
    // Only the owned host changes zoom. The guest factor is observed, never set.
    if (zoomDiagnostic) host.webContents.setZoomFactor(hostZoom);
    const profile = session.fromPartition(`native-clip-${randomUUID()}`);
    const owner = new NativeBrowserViewOwner({
      profile: () => profile,
      preloadPath: () =>
        path.resolve(__dirname, "../dist/features/browser-keyboard/guest-preload.js"),
      prepare: () => {},
    });
    owner.registerHost(host);
    const identity = owner.create(host.webContents.id, {
      browserId: "native-clip",
      workspaceId: "clip-fixture",
      url: `http://127.0.0.1:${server.address().port}`,
    });
    const contents = webContents.fromId(identity.webContentsId);
    await step("page-navigation", () =>
      owner.navigate(
        host.webContents.id,
        identity.browserId,
        `http://127.0.0.1:${server.address().port}/fresh`,
      ),
    );
    const anchor = await step("renderer-anchor", () =>
      host.webContents.executeJavaScript(
        "(()=>{const r=document.querySelector('#anchor').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})()",
      ),
    );
    assert.deepEqual(anchor, clip);
    assert.equal(host.webContents.getZoomFactor(), hostZoom);
    const guestZoom = contents.getZoomFactor();
    nativeViewport.width = Math.round(bounds.width * guestZoom);
    nativeViewport.height = Math.round(bounds.height * guestZoom);
    record("zoom-contract", "observed", {
      requestedCss: bounds,
      hostZoom,
      guestZoom,
      nativeViewport,
    });
    const nativeWindowId = host.getNativeWindowHandle().readUInt32LE(0);
    async function geometry(name) {
      const parent = host.contentView.children.find((view) =>
        view.children.some((child) => child.webContents === contents),
      );
      const direct = host.contentView.children.find((view) => view.webContents === contents);
      const child = direct ?? parent?.children.find((view) => view.webContents === contents);
      const nativeWindow = JSON.parse(
        (
          await execFileAsync(
            path.resolve(__dirname, "../../../.dev/x11-surface"),
            ["inspect", String(nativeWindowId)],
            { timeout: 2000 },
          )
        ).stdout,
      );
      const snapshot = {
        nativeWindowId,
        nativeWindow,
        hostWindowId: host.id,
        nativeOwnerWindowId: BrowserWindow.fromWebContents(contents)?.id,
        hostContentsId: host.webContents.id,
        pageContentsId: contents.id,
        rootBounds: host.contentView.getBounds(),
        rootVisible: host.contentView.getVisible(),
        parentBounds: parent?.getBounds(),
        parentVisible: parent?.getVisible(),
        childBounds: child?.getBounds(),
        childVisible: child?.getVisible(),
        directAttached: Boolean(direct),
        nestedAttached: Boolean(parent && child),
        hostBounds: host.getContentBounds(),
        hostVisible: host.isVisible(),
        hostMinimized: host.isMinimized(),
        hostFocused: host.isFocused(),
        pageFocused: contents.isFocused(),
        hostZoom: host.webContents.getZoomFactor(),
        guestZoom: contents.getZoomFactor(),
      };
      record(name, "observed", snapshot);
      assert.equal(snapshot.nativeOwnerWindowId, host.id);
      assert.equal(nativeWindow.mapState, 2);
      assert.equal(nativeWindow.rootX, snapshot.hostBounds.x + 20);
      assert.equal(nativeWindow.rootY, snapshot.hostBounds.y + 20);
      return { parent, child };
    }
    const hostArea = host.getContentBounds();
    async function rootComposition(name, nested) {
      const points = [
        [inHostDip(350), inHostDip(300)],
        [inHostDip(150), inHostDip(250)],
        [inHostDip(clip.x + clip.width + 50), inHostDip(250)],
        [inHostDip(350), inHostDip(clip.y + clip.height + 20)],
      ];
      const expected = nested
        ? [
            [34, 153, 102],
            [153, 34, 85],
            [153, 34, 85],
            [153, 34, 85],
          ]
        : [[34, 153, 102]];
      const observations = [];
      const deadline = Date.now() + 2000;
      let matched = false;
      await step(
        `${name}:root-pixel-observation`,
        async () => {
          do {
            const result = await execFileAsync(
              "python3",
              [
                pointer,
                "probe",
                JSON.stringify(points.map(([x, y]) => [hostArea.x + x, hostArea.y + y])),
              ],
              { timeout: 1000 },
            );
            const observed = JSON.parse(result.stdout);
            observations.push(observed);
            matched = expected.every((rgb, index) =>
              rgb.every((value, channel) => observed.pixels[index][channel] === value),
            );
          } while (!matched && Date.now() < deadline);
        },
        3000,
      );
      record(`${name}:root-pixel-observations`, "observed", {
        first: observations[0],
        final: observations.at(-1),
        count: observations.length,
        matched,
      });
      // Save actual composed pixels even when the readiness predicate fails.
      const capturePath = path.join(outDir, `${name}-host-composition.png`);
      await step(`${name}:root-composition`, () =>
        execFileAsync(
          "python3",
          [
            pointer,
            "capture",
            String(hostArea.x),
            String(hostArea.y),
            String(hostArea.width),
            String(hostArea.height),
            capturePath,
          ],
          { timeout: 5000 },
        ),
      );
      assert.equal(matched, true, `${name}: expected fresh native composition not observed`);
      return nativeImage.createFromPath(capturePath);
    }
    owner.present(host.webContents.id, {
      viewportMode: "fixed",
      browserId: identity.browserId,
      visible: true,
      bounds,
    });
    host.showInactive();
    await geometry("direct-after-show");
    await rootComposition("direct", false);
    await geometry("direct-after-composition");
    // The production correction moves this same page into an already attached parent.
    owner.present(host.webContents.id, {
      viewportMode: "fixed",
      browserId: identity.browserId,
      visible: true,
      bounds,
      clip: anchor,
    });
    const { parent, child } = await geometry("nested-after-attachment");
    assert.ok(parent && child, "Actual native parent owns the same native page");
    // Independent oracle: convert host CSS clip edges before rounding inward.
    // The child position subtracts the integer clip origin from the rounded
    // absolute page origin. Rounding a relative delta loses a DIP at half edges.
    const nearClipX = Math.ceil(clip.x * hostZoom);
    const nearClipY = Math.ceil(clip.y * hostZoom);
    assert.deepEqual(parent.getBounds(), {
      x: nearClipX,
      y: nearClipY,
      width: Math.floor((clip.x + clip.width) * hostZoom) - nearClipX,
      height: Math.floor((clip.y + clip.height) * hostZoom) - nearClipY,
    });
    assert.deepEqual(child.getBounds(), {
      x: Math.round(bounds.x * hostZoom) - nearClipX,
      y: Math.round(bounds.y * hostZoom) - nearClipY,
      ...nativeViewport,
    });
    await step("fresh-pixels", () =>
      contents.executeJavaScript(
        "document.querySelector('#top').style.background='rgb(170,51,85)';document.querySelector('#bottom').style.background='rgb(119,136,153)'",
      ),
    );
    const captureFocus = { host: host.isFocused(), guest: contents.isFocused() };
    const image = await step(
      "full-native-capture",
      () => getNativeBrowserSurface(contents.id).capture(AbortSignal.timeout(10000)),
      12000,
    );
    await fs.writeFile(path.join(outDir, "native-full-viewport.png"), image.toPNG());
    const metrics = await step("post-capture-metrics", () =>
      contents.executeJavaScript("({width:innerWidth,height:innerHeight,scale:devicePixelRatio})"),
    );
    record("css-geometry", "observed", metrics);
    const imageSize = image.getSize();
    record("capture-contract", "observed", {
      metrics,
      imageSize,
      nativeViewport,
      guestZoom: contents.getZoomFactor(),
      captureFocus,
      afterFocus: { host: host.isFocused(), guest: contents.isFocused() },
    });
    assert.equal(contents.getZoomFactor(), guestZoom);
    assert.deepEqual({ host: host.isFocused(), guest: contents.isFocused() }, captureFocus);
    // Exact requested CSS is gated after crop and OS-hit observations, so a zoom
    // mismatch still leaves evidence distinguishing geometry, paint and input.
    assert.deepEqual(imageSize, nativeViewport);
    function pixel(bitmapImage, x, y) {
      const bitmap = bitmapImage.toBitmap();
      const offset = (y * bitmapImage.getSize().width + x) * 4;
      return [bitmap[offset + 2], bitmap[offset + 1], bitmap[offset]];
    }
    assert.deepEqual(pixel(image, Math.floor(imageSize.width / 2), 8), [170, 51, 85]);
    assert.deepEqual(
      pixel(image, Math.floor(imageSize.width / 2), imageSize.height - 8),
      [119, 136, 153],
    );
    if (zoomDiagnostic) {
      const cropRect = { x: 0, y: 0, width: 64, height: 16 };
      const cropped = await step(
        "native-dip-crop",
        () => getNativeBrowserSurface(contents.id).capture(AbortSignal.timeout(10000), cropRect),
        12000,
      );
      await fs.writeFile(path.join(outDir, "native-dip-crop.png"), cropped.toPNG());
      record("native-dip-crop", "observed", {
        cropRect,
        size: cropped.getSize(),
        pixel: pixel(cropped, 32, 8),
      });
      assert.deepEqual(cropped.getSize(), { width: 64, height: 16 });
      assert.deepEqual(pixel(cropped, 32, 8), [170, 51, 85]);
    }
    await geometry("nested-after-full-capture");
    const composition = await rootComposition("nested", true);
    await geometry("nested-after-composition");
    const painted = {
      inside: pixel(composition, inHostDip(350), inHostDip(300)),
      outsideLeft: pixel(composition, inHostDip(150), inHostDip(250)),
      outsideRight: pixel(composition, inHostDip(clip.x + clip.width + 50), inHostDip(250)),
      outsideBottom: pixel(composition, inHostDip(350), inHostDip(clip.y + clip.height + 20)),
    };
    record("native-painted-clip", "observed", painted);
    assert.deepEqual(painted.inside, [34, 153, 102]);
    for (const outside of [painted.outsideLeft, painted.outsideRight, painted.outsideBottom])
      assert.deepEqual(outside, [153, 34, 85]);
    const beforeInput = {
      hostFocused: host.isFocused(),
      pageFocused: contents.isFocused(),
      hostVisible: host.isVisible(),
      pageVisible: child.getVisible(),
    };
    record("before-native-input", "observed", beforeInput);
    async function click(name, x, y) {
      await step(name, () =>
        execFileAsync(
          "python3",
          [pointer, "click", String(hostArea.x + inHostDip(x)), String(hostArea.y + inHostDip(y))],
          { timeout: 3000 },
        ),
      );
      // Wait for real event delivery, without generating replacement/replayed input.
      return step(`${name}:event-delivery`, () =>
        host.webContents.executeJavaScript(
          "new Promise(resolve=>{const end=Date.now()+2000;function check(){if(window.hits.length || Date.now()>=end)resolve(window.hits);else setTimeout(check,25)}check()})",
        ),
      );
    }
    await click("outside-clip-os-click", 150, 250);
    const outsidePageHits = await step("outside-page-hits", () =>
      contents.executeJavaScript("window.hits"),
    );
    const outsideHostHits = await step("outside-host-hits", () =>
      host.webContents.executeJavaScript("window.hits"),
    );
    record("outside-hit-result", "observed", { outsidePageHits, outsideHostHits });
    assert.equal(outsidePageHits.length, 0);
    assert.equal(outsideHostHits.length, 1);
    assert.equal(outsideHostHits[0].trusted, true);
    await click("inside-clip-os-click", 350, 300);
    const insideHits = await step("inside-page-hits", () =>
      contents.executeJavaScript(
        "new Promise(resolve=>{const end=Date.now()+2000;function check(){if(window.hits.length || Date.now()>=end)resolve(window.hits);else setTimeout(check,25)}check()})",
      ),
    );
    record("inside-hit-result", "observed", { insideHits });
    assert.equal(insideHits.length, 1);
    assert.equal(insideHits[0].trusted, true);
    const expectedHit = { x: inHostDip(250) / guestZoom, y: inHostDip(200) / guestZoom };
    record("input-contract", "observed", {
      hostZoom,
      guestZoom,
      expectedHit,
      actual: insideHits[0],
    });
    assert.ok(
      Math.abs(insideHits[0].x - expectedHit.x) <= 1 &&
        Math.abs(insideHits[0].y - expectedHit.y) <= 1,
      "Trusted guest coordinates match native DIP and the observed guest zoom",
    );
    const exactRequestedCss = metrics.width === bounds.width && metrics.height === bounds.height;
    record("requested-css-gate", "observed", {
      exactRequestedCss,
      requested: { width: bounds.width, height: bounds.height },
      actual: metrics,
    });
    assert.deepEqual(
      metrics,
      { width: bounds.width, height: bounds.height, scale: 1 },
      "Requested CSS viewport remains exact without guest zoom repair",
    );
    owner.close(host.webContents.id, identity.browserId);
    assert.equal(getNativeBrowserSurface(contents.id), undefined);
    return {
      backend: "production-native-owner-parent-clip",
      proofScope: "synthetic renderer anchor, geometry primitive only",
      platform: process.platform,
      architecture: process.arch,
      versions: process.versions,
      bounds,
      clip,
      hostZoom,
      guestZoom,
      metrics,
      painted,
      beforeInput,
      outsideHostHits,
      insideHits,
      unverified: [
        "actual React pane",
        "host zoom other than1/DPR",
        "minimized host",
        "keyboard/IME/accessibility",
        "extensions/restart",
        "native Windows/macOS",
      ],
    };
  } finally {
    record("cleanup", "started");
    if (host && !host.isDestroyed()) host.destroy();
    server.closeAllConnections();
    const address = server.address();
    await step("server-close", () => new Promise((resolve) => server.close(resolve)), 2000);
    record("server-port", "closed", { host: "127.0.0.1", port: address?.port });
    record("cleanup", "completed");
  }
}
module.exports = { runNativeParentClipFixture };
