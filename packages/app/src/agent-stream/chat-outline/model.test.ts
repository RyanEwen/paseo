import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { fetchPromptContent } from "../fetch-prompt-content";
import { describe, expect, it, vi } from "vitest";
import {
  createActivePromptPublisher,
  shouldAcceptPromptIndexEpoch,
  promptTickMagnification,
  resolveActivePromptSeq,
  OUTLINE_MAGNIFY_RADIUS,
  type ChatOutlinePrompt,
} from "./model";

describe("chat outline prompt index epoch", () => {
  it("accepts only the authoritative timeline epoch", () => {
    expect(shouldAcceptPromptIndexEpoch("epoch-2", "epoch-2")).toBe(true);
    expect(shouldAcceptPromptIndexEpoch("epoch-2", "epoch-1")).toBe(false);
  });
});

function prompt(seq: number): ChatOutlinePrompt {
  return { seq, timestamp: new Date(seq).toISOString(), preview: `prompt ${seq}` };
}

describe("promptTickMagnification", () => {
  it("peaks under the pointer and decays to nothing at the radius", () => {
    expect(promptTickMagnification(0)).toBe(1);
    expect(promptTickMagnification(OUTLINE_MAGNIFY_RADIUS)).toBe(0);
    expect(promptTickMagnification(OUTLINE_MAGNIFY_RADIUS + 10)).toBe(0);
  });

  it("falls off monotonically and symmetrically around the pointer", () => {
    const above = [0, 1, 2, 3].map((distance) => promptTickMagnification(distance));
    const below = [0, -1, -2, -3].map((distance) => promptTickMagnification(distance));

    expect(above).toEqual(below);
    expect(above).toEqual([...above].sort((left, right) => right - left));
  });
});

describe("resolveActivePromptSeq", () => {
  const prompts = [prompt(2), prompt(9), prompt(20)];

  it("marks the prompt whose turn the reading position sits in", () => {
    expect(resolveActivePromptSeq(prompts, 9)).toBe(9);
    expect(resolveActivePromptSeq(prompts, 14)).toBe(9);
    expect(resolveActivePromptSeq(prompts, 20)).toBe(20);
    expect(resolveActivePromptSeq(prompts, 99)).toBe(20);
  });

  it("marks nothing above the first prompt or without a reading position", () => {
    expect(resolveActivePromptSeq(prompts, 1)).toBeNull();
    expect(resolveActivePromptSeq(prompts, null)).toBeNull();
    expect(resolveActivePromptSeq([], 42)).toBeNull();
  });
});

describe("createActivePromptPublisher", () => {
  it("notifies subscribers only when the active prompt changes", () => {
    const publisher = createActivePromptPublisher();
    let notifications = 0;
    const unsubscribe = publisher.subscribe(() => {
      notifications += 1;
    });

    publisher.publish(9);
    publisher.publish(9);
    publisher.publish(20);
    unsubscribe();
    publisher.publish(null);

    expect(notifications).toBe(2);
    expect(publisher.getActiveSeq()).toBeNull();
  });
});

it("reads a complete indexed prompt with one entry and preserves canonical text", async () => {
  const text = `Long prompt\n${"  Original whitespace.\n".repeat(60)}END`;
  const fetchAgentTimeline = vi.fn().mockResolvedValue({
    epoch: "epoch",
    reset: false,
    staleCursor: false,
    error: null,
    entries: [
      {
        provider: "mock",
        item: { type: "user_message", text, messageId: "prompt" },
        timestamp: "2026-10-12T00:00:00.000Z",
        seqStart: 0,
        seqEnd: 0,
      },
    ],
  });
  const client = { fetchAgentTimeline } as unknown as DaemonClient;
  const result = await fetchPromptContent(client, "agent", "epoch", 0);
  expect(fetchAgentTimeline).toHaveBeenCalledWith("agent", {
    direction: "before",
    cursor: { epoch: "epoch", seq: 1 },
    limit: 1,
    projection: "projected",
  });
  expect(result.text).toBe(text);
  expect(result.timelineCursor).toEqual({ epoch: "epoch", seq: 0 });
  fetchAgentTimeline.mockResolvedValue({ epoch: "changed", error: null, entries: [] });
  await expect(fetchPromptContent(client, "agent", "epoch", 0)).rejects.toThrow("unavailable");
});
