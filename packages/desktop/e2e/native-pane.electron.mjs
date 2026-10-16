import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { warmMetro } from "../../app/e2e/support/metro-warmup.mjs";
import { observeHiddenNativeCapture } from "./native-pane-privacy.electron.mjs";
const execFileAsync = promisify(execFile);

/** Record a bounded fixture step, including failure, without replaying its operation. */
async function recordStage(artifactDir, name, operation, timeoutMs) {
  const startedAt = Date.now();
  const record = (state, details = {}) => {
    fs.appendFileSync(
      path.join(artifactDir, "native-pane-stages.jsonl"),
      JSON.stringify({ name, state, recordedAtUtc: new Date().toISOString(), ...details }) + "\n",
    );
  };
  record("started");
  let timer;
  try {
    const result = await Promise.race([
      operation(),
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Native pane stage deadline: ${name}`)),
          timeoutMs,
        );
      }),
    ]);
    record("passed", { elapsedMs: Date.now() - startedAt, result });
    return result;
  } catch (error) {
    record("failed", { elapsedMs: Date.now() - startedAt, error: String(error) });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Compile Metro's actual document scripts before starting the unchanged UI readiness gate.
 * Main-process IPC readiness and Metro's listening socket do not prove bundle readiness.
 * Preserve post-bundle renderer observations even if the app remains on its splash.
 */
export async function prepareNativePaneRenderer({ page, expoPort, artifactDir, timeoutMs }) {
  await recordStage(
    artifactDir,
    "metro-document-and-bundles-ready",
    () => warmMetro(expoPort),
    125000,
  );
  fs.writeFileSync(
    path.join(artifactDir, "post-bundle-renderer.json"),
    JSON.stringify(
      await page.evaluate(() => ({
        url: location.href,
        title: document.title,
        readyState: document.readyState,
        text: document.body?.innerText.slice(0, 1024),
        scripts: [...document.scripts].map((script) => script.src).filter(Boolean),
      })),
      null,
      2,
    ) + "\n",
  );
  await recordStage(
    artifactDir,
    "paseo-settings-ui-ready",
    () =>
      page
        .getByRole("button", { name: "Settings", exact: true })
        .waitFor({ state: "visible", timeout: timeoutMs }),
    timeoutMs + 1000,
  );
}

/** Exercise the actual React native pane via the existing isolated desktop journey.
 * Menus are kept enabled but unopened. Native OS input is limited to owned private
 * XTest input; all other automation calls retain their explicit fixture browser ID.
 */
export async function runNativePaneRegression({
  page,
  client,
  serverId,
  targetUrl,
  workspaceIds,
  artifactDir,
  inspectorPort,
  inspectWindowPresentation,
  callBrowserTool,
  assert,
  rootDir,
}) {
  const receipts = [];
  async function stage(name, operation) {
    const result = await recordStage(artifactDir, name, operation, 25000);
    receipts.push({ name, result });
    return result;
  }
  async function nativeState(browserId) {
    return inspectWindowPresentation(
      inspectorPort,
      "",
      `(() => {
      const c = process.mainModule.require(${JSON.stringify(path.join(rootDir, "packages/desktop/dist/features/browser-webviews/index.js"))}).getPaseoBrowserWebContentsForHostWindow(${JSON.stringify(browserId)}, win.webContents.id);
      if (!c) return null;
      const parent = win.contentView.children.find(v => v.children.some(child => child.webContents === c));
      const view = parent?.children.find(child => child.webContents === c) ?? win.contentView.children.find(v => v.webContents === c);
      return { id:c.id, type:c.getType(), url:c.getURL(), title:c.getTitle(), loading:c.isLoading(), visible:view?.getVisible(), clip:parent?.getBounds(), clipVisible:parent?.getVisible(), bounds:view?.getBounds(), rootVisible:win.contentView.getVisible(), rootBounds:win.contentView.getBounds(), rootChildCount:win.contentView.children.length, clipChildCount:parent?.children.length, hostContentsId:win.webContents.id, actualOwnerContentsId:process.mainModule.require('electron').BrowserWindow.fromWebContents(c)?.webContents.id, hostBounds:win.getContentBounds(), hostFocused:win.isFocused(), hostContentsFocused:win.webContents.isFocused(), pageFocused:c.isFocused(), nativeWindowId:win.getNativeWindowHandle().readUInt32LE(0) };
    })()`,
    );
  }
  async function waitState(browserId, predicate, message) {
    const deadline = Date.now() + 10000;
    let state;
    do {
      state = await nativeState(browserId);
      if (predicate(state)) return state;
    } while (Date.now() < deadline);
    throw new Error(`${message}: ${JSON.stringify(state)}`);
  }
  async function evaluate(browserId, expression) {
    return JSON.parse(
      (
        await callBrowserTool(client, "browser_evaluate", {
          browserId,
          function: `() => (${expression})`,
        })
      ).resultJson,
    );
  }
  async function paintedApp(name) {
    const presentation = await inspectWindowPresentation(inspectorPort);
    const area = await inspectWindowPresentation(inspectorPort, "", "win.getContentBounds()");
    const output = path.join(artifactDir, `${name}.png`);
    await execFileAsync(
      "python3",
      [
        path.join(rootDir, "packages/desktop/capture-harness/private-display-pointer.py"),
        "capture",
        String(area.x),
        String(area.y),
        String(area.width),
        String(area.height),
        output,
      ],
      { timeout: 5000 },
    );
    return { area, presentation, output };
  }
  async function capture(browserId, width, height, name, onCaptureRequested) {
    const markers = name.startsWith("inactive")
      ? { top: [51, 85, 170], bottom: [136, 153, 119] }
      : { top: [170, 51, 85], bottom: [119, 136, 153] };
    await evaluate(
      browserId,
      `(()=>{document.body.style.background='rgb(34,153,102)';document.querySelector('#top').style.background='rgb(${markers.top.join(",")})';document.querySelector('#bottom').style.background='rgb(${markers.bottom.join(",")})';return true})()`,
    );
    const beforeCapture = await nativeState(browserId);
    const pendingCapture = client.callTool({ name: "browser_screenshot", args: { browserId } });
    onCaptureRequested?.();
    const response = await pendingCapture;
    const image = response.content.find((item) => item.type === "image");
    assert(image, `Native screenshot missing: ${JSON.stringify(response.structuredContent)}`);
    const output = path.join(artifactDir, `${name}.png`);
    fs.writeFileSync(output, Buffer.from(image.data, "base64"));
    const pixels = await inspectWindowPresentation(
      inspectorPort,
      "",
      `(() => { const image=process.mainModule.require('electron').nativeImage.createFromPath(${JSON.stringify(output)}); const size=image.getSize(); const bitmap=image.toBitmap(); const rgb=y=>{const i=(y*size.width+Math.floor(size.width/2))*4;return[bitmap[i+2],bitmap[i+1],bitmap[i]]}; return {size,top:rgb(8),bottom:rgb(size.height-8)};})()`,
    );
    const metrics = await evaluate(
      browserId,
      "({width:innerWidth,height:innerHeight,scale:devicePixelRatio,draft:document.querySelector('#typing-target').value})",
    );
    const afterCapture = await nativeState(browserId);
    const viewportMatches =
      metrics.width === width && metrics.height === height && metrics.scale === 1;
    const failureHost = viewportMatches ? undefined : await paintedApp(`${name}-host-at-failure`);
    // Native bounds distinguish rejected/overwritten presentation from renderer
    // propagation. Save both observations before a failed viewport assertion exits.
    fs.writeFileSync(
      path.join(artifactDir, `${name}-geometry.json`),
      JSON.stringify(
        {
          requested: { width, height },
          beforeCapture,
          afterCapture,
          pixels,
          markers,
          metrics,
          failureHost,
        },
        null,
        2,
      ) + "\n",
    );
    assert(viewportMatches, `Native CSS viewport mismatch: ${JSON.stringify(metrics)}`);
    assert(
      pixels.size.width === width && pixels.size.height === height,
      `Native frame mismatch: ${JSON.stringify(pixels)}`,
    );
    assert(
      JSON.stringify(pixels.top) === JSON.stringify(markers.top) &&
        JSON.stringify(pixels.bottom) === JSON.stringify(markers.bottom),
      `Native stale edge pixels: ${JSON.stringify(pixels)}`,
    );
    return { pixels, metrics, output };
  }
  await stage("select-real-workspace", () =>
    page.getByTestId(`sidebar-workspace-row-${serverId}:${workspaceIds[0]}`).click(),
  );
  const created = await stage("background-native-new-tab", () =>
    callBrowserTool(client, "browser_new_tab", { url: targetUrl }),
  );
  const browserId = created.browserId;
  await stage("select-real-browser-tab", () =>
    page
      .getByTestId(`workspace-deck-entry-${serverId}:${workspaceIds[0]}`)
      .getByTestId(`workspace-tab-browser_${browserId}`)
      .click(),
  );
  const initial = await stage("actual-native-pane-presentation", () =>
    waitState(
      browserId,
      (state) => state?.visible && state.clip?.width > 0,
      "React pane did not present native view",
    ),
  );
  assert((await page.locator("webview").count()) === 0, "React pane created a DOM webview");
  await page.evaluate(async () => {
    window.nativePaneEvents = [];
    window.nativePaneDispose = await window.paseoDesktop.events.on("browser-view-state", (state) =>
      window.nativePaneEvents.push({
        url: state.url,
        title: state.title,
        loading: state.isLoading,
        browserId: state.browserId,
      }),
    );
  });
  await stage("native-pane-url-navigation", async () => {
    const input = page.getByRole("textbox", { name: "Browser URL", exact: true });
    await input.fill(targetUrl + "next");
    await input.press("Enter");
    const state = await waitState(
      browserId,
      (row) =>
        row?.url === targetUrl + "next" && !row.loading && row.title === "Native target /next",
      "URL/title/loading did not settle",
    );
    const events = await page.evaluate(() => window.nativePaneEvents);
    assert(
      events.some((event) => event.browserId === browserId && event.loading),
      "No native loading-start state observed",
    );
    return { state, events };
  });
  await stage("real-fixed-viewport-store-update", () =>
    callBrowserTool(client, "browser_resize", { browserId, width: 1920, height: 1080 }),
  );
  const fixed = await stage("real-fixed-viewport-presentation", () =>
    waitState(
      browserId,
      (state) => state?.visible && state.bounds?.width === 1920 && state.bounds?.height === 1080,
      "Fixed viewport did not present",
    ),
  );
  await stage("full-native-viewport-pixels", () =>
    capture(browserId, 1920, 1080, "real-pane-full-viewport"),
  );
  await stage("painted-real-React-pane", () => paintedApp("real-react-native-pane"));
  await stage("private-native-draft-input", async () => {
    const rect = await evaluate(
      browserId,
      "(()=>{const r=document.querySelector('#typing-target').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()",
    );
    const host = await nativeState(browserId);
    const x = host.hostBounds.x + host.clip.x + host.bounds.x + rect.x + rect.width / 2;
    const y = host.hostBounds.y + host.clip.y + host.bounds.y + rect.y + rect.height / 2;
    await execFileAsync(
      "python3",
      [
        path.join(rootDir, "packages/desktop/capture-harness/private-display-pointer.py"),
        "click",
        String(Math.round(x)),
        String(Math.round(y)),
      ],
      { timeout: 3000 },
    );
    await execFileAsync(
      "python3",
      [
        path.join(rootDir, "docs/qa-evidence/browser-focus/private-display-keys.py"),
        "unsaveddraft",
      ],
      { timeout: 3000 },
    );
    const draft = await evaluate(browserId, "document.querySelector('#typing-target').value");
    assert(draft === "unsaveddraft", `Private OS typing failed: ${JSON.stringify(draft)}`);
    return { draft, mechanism: "private X11 XTest mouse and keys" };
  });
  await stage("select-other-real-workspace", () =>
    page.getByTestId(`sidebar-workspace-row-${serverId}:${workspaceIds[1]}`).click(),
  );
  await stage("inactive-native-view-hidden", () =>
    waitState(
      browserId,
      (state) => state && !state.visible,
      "Inactive workspace left native page visible",
    ),
  );
  const before = {
    url: page.url(),
    focus: await page.evaluate(() => document.activeElement?.outerHTML),
    window: await inspectWindowPresentation(inspectorPort),
  };
  const background = await stage("new-tab-while-other-workspace-selected", () =>
    callBrowserTool(client, "browser_new_tab", { url: targetUrl + "background" }),
  );
  assert(page.url() === before.url, "Background new tab changed selected workspace route");
  assert(
    (await page.evaluate(() => document.activeElement?.outerHTML)) === before.focus,
    "Background new tab changed renderer keyboard focus",
  );
  const after = await inspectWindowPresentation(inspectorPort);
  assert(
    after.focused === before.window.focused && after.visible === before.window.visible,
    "Background new tab changed host focus/visibility",
  );
  await stage("inactive-native-resize", () =>
    callBrowserTool(client, "browser_resize", { browserId, width: 412, height: 915 }),
  );
  const observation = await stage(
    "inactive-native-painted-frame-with-privacy-observer",
    async () => {
      const state = await nativeState(browserId);
      await waitState(
        background.browserId,
        (row) => row?.url === targetUrl + "background" && !row.loading,
        "Background guest not ready for receiver observation",
      );
      return observeHiddenNativeCapture({
        page,
        rootDir,
        artifactDir,
        hostBounds: state.hostBounds,
        captureHost: paintedApp,
        nativeSnapshot: () => nativeState(browserId),
        guests: [browserId, background.browserId].map((ownedBrowserId) => ({
          browserId: ownedBrowserId,
          nativeSnapshot: () => nativeState(ownedBrowserId),
          evaluate: (code) => evaluate(ownedBrowserId, code),
        })),
        capture: (onCaptureRequested) =>
          capture(browserId, 412, 915, "inactive-real-native-pane", onCaptureRequested),
      });
    },
  );
  const hidden = observation.result;
  assert(hidden.metrics.draft === "unsaveddraft", "Inactive resize lost the native draft");
  await stage("return-original-real-workspace", () =>
    page.getByTestId(`sidebar-workspace-row-${serverId}:${workspaceIds[0]}`).click(),
  );
  await stage("return-original-real-tab", () =>
    page
      .getByTestId(`workspace-deck-entry-${serverId}:${workspaceIds[0]}`)
      .getByTestId(`workspace-tab-browser_${browserId}`)
      .click(),
  );
  const returned = await stage("retained-native-identity-on-return", () =>
    waitState(
      browserId,
      (state) => state?.visible && state.id === initial.id,
      "Native tab identity changed on return",
    ),
  );
  assert(
    (await evaluate(browserId, "document.querySelector('#typing-target').value")) ===
      "unsaveddraft",
    "Workspace return lost draft",
  );
  await stage("native-tab-close", () =>
    callBrowserTool(client, "browser_close_tab", { browserId }),
  );
  await stage("native-tab-destruction", () =>
    waitState(browserId, (state) => state === null, "Closed native tab was not destroyed"),
  );
  await stage("background-tab-cleanup", () =>
    callBrowserTool(client, "browser_close_tab", { browserId: background.browserId }),
  );
  await page.evaluate(() => window.nativePaneDispose?.());
  return {
    proofScope: "actual Electron React browser pane",
    initial,
    fixed,
    returned,
    receipts,
    unverified: [
      "overlapping menus and annotation cards",
      "non-unit host zoom/DPR1.5",
      "minimized host",
      "extensions/profile restart/crash recovery",
      "native Windows ARM64/x64/macOS",
      "IME/accessibility/clipboard/native dialogs",
    ],
  };
}
