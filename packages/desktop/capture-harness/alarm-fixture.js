const { BrowserWindow } = require("electron");
const path = require("node:path");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Let a worker stop naturally before its scheduled alarm; observe the main process without attaching its debugger. */
async function assertSleepingExtensionAlarm({ profile, root }) {
  const extension = await profile.extensions.loadExtension(path.join(root, "alarm-extension"));
  const popup = new BrowserWindow({
    show: false,
    webPreferences: {
      session: profile,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  function running() {
    return Object.values(profile.serviceWorkers.getAllRunning()).some(
      (worker) => worker.scope === `chrome-extension://${extension.id}/`,
    );
  }

  try {
    await popup.loadURL(`chrome-extension://${extension.id}/popup.html`);
    const scheduled = await popup.webContents.executeJavaScript(
      'chrome.runtime.sendMessage({type: "paseo-schedule-idle-alarm"})',
    );
    if (!scheduled || scheduled.error || typeof scheduled.scheduledTime !== "number") {
      throw new Error("The native extension fixture could not schedule its alarm.");
    }

    await delay(35000);
    if (running()) {
      throw new Error("The alarm worker did not stop naturally before its deadline.");
    }
    await delay(Math.max(0, scheduled.scheduledTime + 10000 - Date.now()));
    const { alarmWake } = await popup.webContents.executeJavaScript(
      'chrome.storage.local.get("alarmWake")',
    );
    const remaining = await popup.webContents.executeJavaScript("chrome.alarms.getAll()");
    if (
      !running() ||
      !alarmWake ||
      alarmWake.name !== "paseo-idle-wake" ||
      alarmWake.scheduledTime !== scheduled.scheduledTime ||
      alarmWake.workerInstance === scheduled.workerInstance
    ) {
      throw new Error(
        `The scheduled alarm did not wake a fresh worker and reach its listener: ${JSON.stringify({
          running: running(),
          scheduled,
          alarmWake,
          remaining,
        })}`,
      );
    }
    if (remaining.length !== 0) {
      throw new Error("The one-shot alarm remained registered after delivery.");
    }
  } finally {
    popup.destroy();
    profile.extensions.removeExtension(extension.id);
  }
}

module.exports = { assertSleepingExtensionAlarm };
