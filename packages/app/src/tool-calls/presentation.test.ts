import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import { describe, expect, it } from "vitest";
import { createInstance } from "i18next";
import { en } from "@/i18n/resources/en";

import { buildToolCallPresentation, type ToolCallPresentationIcon } from "./presentation";

const fakeIcons = {
  brain: (() => null) as ToolCallPresentationIcon,
  eye: (() => null) as ToolCallPresentationIcon,
  wrench: (() => null) as ToolCallPresentationIcon,
};

function fakeResolveIcon(
  toolName: string,
  detail: ToolCallDetail | undefined,
): ToolCallPresentationIcon {
  if (detail?.type === "plan") {
    return fakeIcons.brain;
  }
  if (detail?.type === "read") {
    return fakeIcons.eye;
  }
  if (toolName === "exec_command") {
    return fakeIcons.wrench;
  }
  return fakeIcons.wrench;
}

describe("tool-call presentation", () => {
  const translation = createInstance();
  void translation.init({ lng: "en", resources: { en: { translation: en } }, initAsync: false });

  it.each(["running", "completed", "failed", "canceled"] as const)(
    "uses truthful %s labels while retaining exact shell details and classic opt-out",
    (status) => {
      const detail = {
        type: "shell",
        command: "cat src/notifications.ts",
        output: "exact output",
        cwd: "/work",
      } satisfies ToolCallDetail;
      const input = {
        toolName: "shell",
        status,
        error: status === "failed" ? "failure" : null,
        detail,
        cwd: "/work",
        metadata: {
          commandActions: [
            {
              type: "read",
              command: detail.command,
              name: "notifications.ts",
              path: "/work/src/notifications.ts",
            },
          ],
        },
        resolveIcon: fakeResolveIcon,
      };
      const readable = buildToolCallPresentation({ ...input, activityTranslation: translation.t });
      const expected = {
        running: "Reading",
        completed: "Read",
        failed: "Failed: Read",
        canceled: "Canceled: Read",
      };
      expect(readable.displayName).toBe(expected[status]);
      expect(readable.summary).toBe("src/notifications.ts");
      expect(readable.detail).toBe(detail);
      expect(readable.canOpenDetails).toBe(true);
      expect(readable.icon).toBe(fakeIcons.eye);
      const classic = buildToolCallPresentation(input);
      expect(classic.displayName).toBe("Shell");
      expect(classic.summary).toBe(detail.command);
      expect(classic.detail).toBe(detail);
    },
  );

  it("does not invent writes for opaque scripts or malformed actions", () => {
    const detail = {
      type: "shell",
      command: "python - <<'PY'\nopen('new.ts','w').write('x')\nPY",
      output: "done",
    } satisfies ToolCallDetail;
    const result = buildToolCallPresentation({
      toolName: "shell",
      status: "completed",
      error: null,
      detail,
      metadata: { commandActions: [{ type: "read", path: 42 }] },
      activityTranslation: translation.t,
      resolveIcon: fakeResolveIcon,
    });
    expect(result.displayName).toBe("Ran command");
    expect(result.summary).toBeUndefined();
    expect(result.detail).toBe(detail);
  });

  it("distinguishes generic writes from proven creation and handles mixed batches", () => {
    const detail = { type: "write", filePath: "/work/a.ts", content: "x" } satisfies ToolCallDetail;
    const input = {
      toolName: "Write",
      status: "completed" as const,
      error: null,
      detail,
      cwd: "/work",
      activityTranslation: translation.t,
      resolveIcon: fakeResolveIcon,
    };
    expect(buildToolCallPresentation(input).displayName).toBe("Wrote");
    expect(
      buildToolCallPresentation({
        ...input,
        metadata: { fileChanges: [{ path: "/work/a.ts", kind: "add" }] },
      }).displayName,
    ).toBe("Created");
    const mixed = buildToolCallPresentation({
      ...input,
      metadata: {
        fileChanges: [
          { path: "/work/a.ts", kind: "add", diff: "+a" },
          { path: "/work/b.ts", kind: "update", diff: "-b\n+c" },
          { path: "/work/c.ts", kind: "delete", diff: "-c" },
        ],
      },
    });
    expect(mixed.displayName).toBe("Changed files");
    expect(mixed.summary).toBe("a.ts, b.ts, c.ts");
    const classicBatch = buildToolCallPresentation({
      ...input,
      activityTranslation: undefined,
      metadata: {
        fileChanges: [
          { path: "/work/a.ts", kind: "add", diff: "+a" },
          { path: "/work/b.ts", kind: "update", diff: "-b\n+c" },
          { path: "/work/c.ts", kind: "delete", diff: "-c" },
        ],
      },
    });
    expect(classicBatch.displayName).toBe("Write");
    expect(classicBatch.detail).toEqual(mixed.detail);
    expect(mixed.detail).toMatchObject({
      type: "unknown",
      output: {
        files: [
          { path: "/work/a.ts", kind: "add", diff: "+a" },
          { path: "/work/b.ts", kind: "update", diff: "-b\n+c" },
          { path: "/work/c.ts", kind: "delete", diff: "-c" },
        ],
      },
    });
  });
  it("builds badge, detail, icon, and file-open policy in one model", () => {
    const presentation = buildToolCallPresentation({
      toolName: "read_file",
      status: "completed",
      error: null,
      cwd: "/tmp/repo",
      detail: {
        type: "read",
        filePath: "/tmp/repo/src/index.ts",
        content: "console.log('hi');",
      },
      resolveIcon: fakeResolveIcon,
    });

    expect(presentation).toMatchObject({
      displayName: "Read",
      summary: "src/index.ts",
      icon: fakeIcons.eye,
      isLoadingDetails: false,
      hasDetails: true,
      canOpenDetails: true,
      openFilePath: "/tmp/repo/src/index.ts",
      isPlan: false,
    });
  });

  it("marks running calls without meaningful detail as loading details", () => {
    const presentation = buildToolCallPresentation({
      toolName: "exec_command",
      status: "running",
      error: null,
      detail: {
        type: "unknown",
        input: {},
        output: null,
      },
      resolveIcon: fakeResolveIcon,
    });

    expect(presentation).toMatchObject({
      displayName: "Exec command",
      icon: fakeIcons.wrench,
      isLoadingDetails: true,
      hasDetails: false,
      canOpenDetails: true,
      openFilePath: null,
      isPlan: false,
    });
  });

  it("keeps plan calls out of the expandable badge path", () => {
    const presentation = buildToolCallPresentation({
      toolName: "ExitPlanMode",
      status: "completed",
      error: null,
      detail: {
        type: "plan",
        text: "1. Do the thing",
      },
      resolveIcon: fakeResolveIcon,
    });

    expect(presentation.isPlan).toBe(true);
    expect(presentation.icon).toBe(fakeIcons.brain);
  });
});

it.each([
  ["message", "Message from QA messenger"],
  ["finished", "QA messenger finished"],
  ["errored", "QA messenger errored"],
  ["permission-required", "QA messenger needs permission"],
  ["closed", "QA messenger closed"],
] as const)("presents %s from structured provenance without a second label", (event, heading) => {
  const presentation = buildToolCallPresentation({
    toolName: "internal_name_should_not_be_visible",
    status: "completed",
    error: null,
    detail: { type: "plain_text", label: "legacy summary", text: "legacy body" },
    agentMessage: {
      event,
      sender: { id: "server::sender", title: "QA messenger" },
      text: "The delivered message.",
    },
    resolveIcon: fakeResolveIcon,
  });
  expect(presentation.displayName).toBe(heading);
  expect(presentation.summary).toBeUndefined();
  expect(presentation.detail).toEqual({
    type: "plain_text",
    icon: "bot",
    text: "From agent: server::sender\n\nThe delivered message.",
  });
});

it("uses an opaque sender ID when no title is available", () => {
  const presentation = buildToolCallPresentation({
    toolName: "agent_message",
    status: "completed",
    error: null,
    agentMessage: { event: "message", sender: { id: "remote::worker" }, text: "Hello" },
    resolveIcon: fakeResolveIcon,
  });
  expect(presentation.displayName).toBe("Message from remote::worker");
});
