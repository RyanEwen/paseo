import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type pino from "pino";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createPushNotifications } from "./index.js";
import { PushService } from "./push-service.js";

function createLogger(): pino.Logger {
  const logger = {
    child: () => logger,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  return logger as unknown as pino.Logger;
}

describe("push notifications", () => {
  const homes: string[] = [];

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const home of homes.splice(0)) {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("production and debug projects both receive notifications", async () => {
    const delivered: string[] = [];
    // Model Expo's project restriction at the HTTP boundary without sending
    // synthetic device tokens to the real notification service.
    vi.stubGlobal("fetch", async (_url: string, options: RequestInit) => {
      const messages = JSON.parse(String(options.body)) as Array<{ to: string }>;
      if (messages.length > 1) {
        return Response.json(
          { errors: [{ code: "PUSH_TOO_MANY_EXPERIENCE_IDS" }] },
          { status: 400 },
        );
      }
      delivered.push(messages[0].to);
      return Response.json({ data: [{ status: "ok", id: "test-ticket" }] });
    });
    const revokeToken = vi.fn();
    const service = new PushService(createLogger(), revokeToken);

    await service.sendPush(["production-device", "debug-device"], {
      title: "Agent finished",
      body: "Done",
    });

    expect(delivered).toEqual(["production-device", "debug-device"]);
    expect(revokeToken).not.toHaveBeenCalled();
  });

  test("an offline device stops receiving notifications after 48 hours", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "paseo-push-notifications-"));
    homes.push(home);
    const filePath = path.join(home, "push-tokens.json");
    let now = Date.parse("2026-08-10T00:00:00.000Z");
    const deliveries: string[][] = [];
    const pushNotifications = createPushNotifications({
      logger: createLogger(),
      filePath,
      now: () => now,
      deliver: async (tokens) => deliveries.push(tokens),
    });

    pushNotifications.renew("ExponentPushToken[offline-device]");
    now += 48 * 60 * 60 * 1000;
    await pushNotifications.send({ title: "Agent finished", body: "Done" });

    expect(deliveries).toEqual([]);
    expect(JSON.parse(readFileSync(filePath, "utf8"))).toEqual({ subscriptions: [] });
  });

  test("online revocation stops notifications immediately", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "paseo-push-notifications-"));
    homes.push(home);
    const deliveries: string[][] = [];
    const pushNotifications = createPushNotifications({
      logger: createLogger(),
      filePath: path.join(home, "push-tokens.json"),
      now: () => Date.parse("2026-08-10T00:00:00.000Z"),
      deliver: async (tokens) => deliveries.push(tokens),
    });

    pushNotifications.renew("ExponentPushToken[online-device]");
    pushNotifications.revoke("ExponentPushToken[online-device]");
    await pushNotifications.send({ title: "Agent finished", body: "Done" });

    expect(deliveries).toEqual([]);
  });
});
