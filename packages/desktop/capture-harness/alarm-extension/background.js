const workerInstance = crypto.randomUUID();

chrome.alarms.onAlarm.addListener(async (alarm) => {
  await chrome.storage.local.set({
    alarmWake: { name: alarm.name, scheduledTime: alarm.scheduledTime, workerInstance },
  });
});

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message.type !== "paseo-schedule-idle-alarm") {
    return false;
  }

  async function schedule() {
    await chrome.storage.local.remove("alarmWake");
    await chrome.alarms.create("paseo-idle-wake", {
      when: Date.now() + 45000,
      persistAcrossSessions: false,
    });
    const alarm = await chrome.alarms.get("paseo-idle-wake");
    reply({ scheduledTime: alarm.scheduledTime, workerInstance });
  }

  void schedule().catch((error) => reply({ error: String(error) }));
  return true;
});
