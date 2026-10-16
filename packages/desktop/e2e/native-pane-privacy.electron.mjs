import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

/** Install only an owned input receiver and read-only trusted-event listeners.
 * This preserves the failed probe geometry; it does not repair focus or drag regions.
 */
async function createSelectedHostProbe(page) {
  return page.evaluate(() => {
    const panel = document.createElement("div");
    panel.id = "native-capture-privacy-probe";
    panel.style.cssText =
      "position:fixed;left:24px;top:140px;width:280px;height:160px;background:rgb(251,247,239);z-index:200000";
    const input = document.createElement("input");
    input.id = "native-capture-privacy-input";
    input.style.cssText = "position:absolute;left:12px;top:36px;width:240px;height:32px";
    const events = [];
    const listener = (event) =>
      events.push({
        type: event.type,
        key: event.key,
        code: event.code,
        trusted: event.isTrusted,
        target: { tag: event.target?.tagName, id: event.target?.id },
        clientXY: typeof event.clientX === "number" ? [event.clientX, event.clientY] : undefined,
        recordedAtUtc: new Date().toISOString(),
      });
    const names = [
      "pointerdown",
      "pointerup",
      "mousedown",
      "mouseup",
      "keydown",
      "keyup",
      "focusin",
      "focusout",
    ];
    for (const name of names) window.addEventListener(name, listener, true);
    panel.append(input);
    document.body.append(panel);
    input.focus();
    window.nativePrivacyProbe = { panel, input, events, listener, names };
    const rect = input.getBoundingClientRect();
    return {
      route: location.href,
      points: [
        [32, 148],
        [296, 148],
      ],
      input: [Math.round(rect.x + rect.width / 2), Math.round(rect.y + rect.height / 2)],
    };
  });
}

/** Snapshot DOM receiver identity without changing its focus or value. */
async function hostReceiver(page) {
  return page.evaluate(() => ({
    route: location.href,
    documentFocused: document.hasFocus(),
    value: window.nativePrivacyProbe.input.value,
    selectedInputFocused: document.activeElement === window.nativePrivacyProbe.input,
    activeElement: { tag: document.activeElement?.tagName, id: document.activeElement?.id },
    events: [...window.nativePrivacyProbe.events],
  }));
}

/** Snapshot every explicitly owned fixture guest, including the newly opened page. */
async function guestReceivers(guests) {
  return Promise.all(
    guests.map(async (guest) => ({
      browserId: guest.browserId,
      native: await guest.nativeSnapshot(),
      dom: await guest.evaluate(
        "({documentFocused:document.hasFocus(),url:location.href,draft:document.querySelector('#typing-target')?.value,events:[...window.nativeReceiverDiagnostic.events]})",
      ),
    })),
  );
}

/** Allow bounded event delivery for one distinct gesture, without replay or focus changes. */
async function waitReceiverDelivery(page, character, expectedValue) {
  const deadline = Date.now() + 2000;
  do {
    const receiver = await hostReceiver(page);
    if (
      receiver.value === expectedValue &&
      receiver.events.some(
        (event) => event.type === "keydown" && event.key === character && event.trusted,
      )
    )
      return;
  } while (Date.now() < deadline);
  throw new Error(
    `Selected receiver did not receive trusted ${character} within its delivery bound`,
  );
}

/** Admit the actual click receiver and Chromium focus before dispatching its key once. */
async function waitClickReceiver(page, nativeSnapshot, previousEventCount) {
  const deadline = Date.now() + 2000;
  do {
    const receiver = await hostReceiver(page);
    const native = await nativeSnapshot();
    const clickReceived = receiver.events
      .slice(previousEventCount)
      .some(
        (event) =>
          event.type === "mouseup" &&
          event.trusted &&
          event.target.id === "native-capture-privacy-input",
      );
    if (
      clickReceived &&
      receiver.selectedInputFocused &&
      receiver.documentFocused &&
      native.hostContentsFocused
    ) {
      return { receiver, native };
    }
  } while (Date.now() < deadline);
  throw new Error("Trusted click/focus admission failed; key not dispatched");
}

/** Own one bounded observer process, with a single dispatch and recorded birth. */
function startObserver({ rootDir, artifactDir, hostBounds, probe, phase, character }) {
  const child = spawn(
    "python3",
    [
      path.join(rootDir, "packages/desktop/capture-harness/private-display-pointer.py"),
      "observe-capture",
      JSON.stringify({
        points: probe.points.map(([x, y]) => [x + hostBounds.x, y + hostBounds.y]),
        expectedPixels: [
          [251, 247, 239],
          [251, 247, 239],
        ],
        input: [probe.input[0] + hostBounds.x, probe.input[1] + hostBounds.y],
        character,
      }),
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  const receipt = {
    pid: child.pid,
    birth: fs.readFileSync(`/proc/${child.pid}/stat`, "utf8"),
    phase,
    character,
  };
  fs.writeFileSync(
    path.join(artifactDir, `${phase}-observer-process.json`),
    JSON.stringify(receipt, null, 2) + "\n",
  );
  let report;
  let stderr = "";
  let clicked = false;
  let keyed = false;
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  child.stdin.on("error", (error) => {
    stderr += `Observer pipe: ${String(error)}\n`;
  });
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    try {
      const row = JSON.parse(line);
      if (row.state === "ready") resolveReady(row);
      if (row.state === "finished") report = row;
    } catch (error) {
      rejectReady(error);
    }
  });
  const ended = new Promise((resolve) => {
    child.once("exit", (code, signal) => {
      rejectReady(new Error(`Native observer exited before admission: ${code}/${signal}`));
      resolve({ code, signal });
    });
    child.once("error", (error) => {
      rejectReady(error);
      resolve({ error: String(error) });
    });
  });
  const watchdog = setTimeout(() => child.kill("SIGTERM"), 7000);
  return {
    ready,
    click() {
      if (clicked) throw new Error("Native click replay rejected");
      clicked = true;
      child.stdin.write("click\n");
    },
    key() {
      if (!clicked || keyed) throw new Error("Native key replay or ordering rejected");
      keyed = true;
      child.stdin.write("key\n");
    },
    async stop() {
      child.stdin.end("done\n");
      const exit = await ended;
      clearTimeout(watchdog);
      lines.close();
      return { receipt, report, exit, stderr };
    },
  };
}

/** Admit one receiver phase and preserve all observations even on a hard failure. */
async function observeReceiverPhase(context, { phase, character, expectedValue, operation }) {
  const { page, artifactDir, captureHost, nativeSnapshot, guests, probe } = context;
  const observer = startObserver({ ...context, phase, character });
  let result;
  let admitted;
  let beforeNative;
  let beforeReceiver;
  let beforeHost;
  let beforeGuests;
  let observation;
  let clickAdmission;
  try {
    admitted = await observer.ready;
    beforeNative = await nativeSnapshot();
    beforeReceiver = await hostReceiver(page);
    beforeGuests = await guestReceivers(guests);
    beforeHost = await captureHost(`${phase}-selected-workspace-before`);
    observer.click();
    clickAdmission = await waitClickReceiver(page, nativeSnapshot, beforeReceiver.events.length);
    result = await operation(() => observer.key());
    await waitReceiverDelivery(page, character, expectedValue);
  } finally {
    const process = await observer.stop();
    observation = {
      phase,
      character,
      expectedValue,
      admitted,
      beforeNative,
      beforeReceiver,
      beforeHost,
      beforeGuests,
      clickAdmission,
      ...process,
      afterNative: await nativeSnapshot(),
      receiver: await hostReceiver(page),
      guests: await guestReceivers(guests),
      afterHost: await captureHost(`${phase}-selected-workspace-after`),
      probe,
      scope: "injected selected-host DOM input; native hit/focus primitive only",
    };
    fs.writeFileSync(
      path.join(artifactDir, `${phase}-receiver-observation.json`),
      JSON.stringify(observation, null, 2) + "\n",
    );
  }
  const report = observation.report;
  if (!report || report.ended !== "done" || !report.sentInput || report.samples === 0)
    throw new Error(`${phase} observation coverage unavailable`);
  if (
    report.changes.length ||
    observation.receiver.value !== expectedValue ||
    !observation.receiver.selectedInputFocused ||
    observation.receiver.route !== probe.route ||
    !observation.receiver.events.some(
      (event) => event.type === "keydown" && event.key === character && event.trusted,
    )
  ) {
    throw new Error(`${phase} receiver gate failed; see ${phase}-receiver-observation.json`);
  }
  return { result, observation };
}

/** Qualify baseline a without capture, then distinct b during the one owned capture.
 * Baseline failure blocks the capture phase. No previous failed x gesture is repeated.
 * Sampling is finite; receiver identities separate fixture admission from product loss.
 */
export async function observeHiddenNativeCapture(context) {
  const { page, guests, capture } = context;
  const probe = await createSelectedHostProbe(page);
  for (const guest of guests) {
    await guest.evaluate(`(() => {
    const events=[];
    const listener=event=>events.push({type:event.type,key:event.key,code:event.code,trusted:event.isTrusted,target:{tag:event.target?.tagName,id:event.target?.id},clientXY:typeof event.clientX==='number'?[event.clientX,event.clientY]:undefined,recordedAtUtc:new Date().toISOString()});
    const names=['pointerdown','pointerup','mousedown','mouseup','keydown','keyup','focusin','focusout'];
    for(const name of names)window.addEventListener(name,listener,true);
    window.nativeReceiverDiagnostic={events,listener,names};return true;
    })()`);
  }
  try {
    const baseline = await observeReceiverPhase(
      { ...context, probe },
      {
        phase: "baseline",
        character: "a",
        expectedValue: "a",
        operation: async (dispatch) => {
          dispatch();
        },
      },
    );
    const captured = await observeReceiverPhase(
      { ...context, probe },
      {
        phase: "capture",
        character: "b",
        expectedValue: "ab",
        operation: capture,
      },
    );
    return {
      result: captured.result,
      privacy: { baseline: baseline.observation, capture: captured.observation },
    };
  } finally {
    for (const guest of guests) {
      await guest.evaluate(
        `(() => {const probe=window.nativeReceiverDiagnostic;for(const name of probe.names)window.removeEventListener(name,probe.listener,true);delete window.nativeReceiverDiagnostic;return true})()`,
      );
    }
    await page.evaluate(() => {
      const receiverProbe = window.nativePrivacyProbe;
      for (const name of receiverProbe.names)
        window.removeEventListener(name, receiverProbe.listener, true);
      receiverProbe.panel.remove();
      delete window.nativePrivacyProbe;
    });
  }
}
