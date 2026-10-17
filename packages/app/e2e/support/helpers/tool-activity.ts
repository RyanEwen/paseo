import type { ToolCallTimelineItem } from "@getpaseo/protocol/agent-types";
import { mapCodexToolCallFromThreadItem } from "../../../../server/src/server/agent/providers/codex/tool-call-mapper";
import { mapClaudeFailedToolCall } from "../../../../server/src/server/agent/providers/claude/tool-call-mapper";
import { mapOpencodeToolCall } from "../../../../server/src/server/agent/providers/opencode/tool-call-mapper";
import {
  mapToolDetail,
  parseToolArgs,
} from "../../../../server/src/server/agent/providers/pi/tool-call-mapper";

export const ACTIVITY_READ_COMMAND = "cat src/notifications.ts";
export const ACTIVITY_READ_OUTPUT = "export const notification = 'exact preserved output';";
export const ACTIVITY_OPAQUE_COMMAND = "python - <<'PY'\nprint('opaque script output')\nPY";

function mapped(call: ToolCallTimelineItem | null): ToolCallTimelineItem {
  if (!call) throw new Error("Expected canonical provider activity fixture");
  return call;
}

/** Exercise the shipped provider mappers, then deliver their canonical data through a real app socket. */
export function buildToolActivityScene(cwd: string): ToolCallTimelineItem[] {
  return [
    mapped(
      mapCodexToolCallFromThreadItem({
        type: "commandExecution",
        id: "read",
        status: "completed",
        cwd,
        command: ACTIVITY_READ_COMMAND,
        aggregatedOutput: ACTIVITY_READ_OUTPUT,
        exitCode: 0,
        commandActions: [
          {
            type: "read",
            command: ACTIVITY_READ_COMMAND,
            name: "notifications.ts",
            path: `${cwd}/src/notifications.ts`,
          },
        ],
      }),
    ),
    mapped(
      mapClaudeFailedToolCall({
        name: "Edit",
        callId: "failed-edit",
        input: { file_path: "src/failed-edit.ts", old_string: "before", new_string: "after" },
        error: "Edit failed before writing",
      }),
    ),
    {
      type: "tool_call",
      callId: "canceled-write",
      name: "write",
      status: "canceled",
      error: null,
      detail: mapToolDetail(
        parseToolArgs("write", { path: "src/canceled-write.ts", content: "unchanged" }),
        null,
      ),
    },
    mapped(
      mapOpencodeToolCall({
        toolName: "grep",
        callId: "search",
        status: "completed",
        input: { pattern: "notification" },
        output: "src/notifications.ts",
      }),
    ),
    mapped(
      mapCodexToolCallFromThreadItem(
        {
          type: "fileChange",
          id: "multi-patch",
          status: "completed",
          changes: [
            { path: "src/created.ts", kind: { type: "add" }, diff: "+created-file-exact-diff" },
            {
              path: "src/updated.ts",
              kind: { type: "update" },
              diff: "-before\n+updated-file-exact-diff",
            },
            { path: "src/deleted.ts", kind: { type: "delete" }, diff: "-deleted-file-exact-diff" },
          ],
        },
        { cwd },
      ),
    ),
    mapped(
      mapCodexToolCallFromThreadItem({
        type: "commandExecution",
        id: "running-script",
        status: "inProgress",
        command: "npm run test",
        cwd,
      }),
    ),
    mapped(
      mapCodexToolCallFromThreadItem({
        type: "commandExecution",
        id: "opaque-failed",
        status: "failed",
        command: ACTIVITY_OPAQUE_COMMAND,
        cwd,
        aggregatedOutput: "opaque script output",
        exitCode: 1,
      }),
    ),
  ];
}
