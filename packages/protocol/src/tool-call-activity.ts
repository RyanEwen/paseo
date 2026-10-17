import { z } from "zod";
import type { ToolCallDetail } from "./agent-types.js";

// Provider metadata is optional and untrusted, even on persisted history.
const commandActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("read"),
    command: z.string(),
    name: z.string(),
    path: z.string().min(1),
  }),
  z.object({
    type: z.literal("listFiles"),
    command: z.string(),
    path: z.string().nullable().optional(),
  }),
  z.object({
    type: z.literal("search"),
    command: z.string(),
    query: z.string().nullable().optional(),
    path: z.string().nullable().optional(),
  }),
  z.object({ type: z.literal("unknown"), command: z.string() }),
]);
const commandActionsSchema = z.array(commandActionSchema).min(1);
const fileChangesSchema = z
  .array(
    z.object({
      path: z.string().min(1),
      kind: z.enum(["add", "update", "delete", "write", "unknown"]),
      diff: z.string().optional(),
    }),
  )
  .min(1);

export type ToolActivityKind =
  | "read"
  | "edit"
  | "write"
  | "create"
  | "delete"
  | "search"
  | "list"
  | "command"
  | "script"
  | "change";
export interface ToolActivity {
  kind: ToolActivityKind;
  target?: string;
}

/** Validate the entire action batch; malformed or future actions keep the command generic. */
export function parseCommandActions(
  value: unknown,
): z.output<typeof commandActionsSchema> | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const parsed = commandActionsSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** Preserve all file paths and distinguish proven additions from writes that may overwrite. */
export function parseFileChanges(value: unknown): z.output<typeof fileChangesSchema> | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const parsed = fileChangesSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** Recognize only a single script/test invocation, never infer its filesystem effects. */
function commandActivity(command: string): ToolActivity {
  const invocation = command.trim();
  if (/[;&|<>`$\n\r]/.test(invocation)) return { kind: "command" };
  if (
    /^(?:npm|pnpm|yarn|bun) (?:run|test|exec)\b/.test(invocation) ||
    /^(?:node|python3?|bash|sh|tsx) [\w./-]+\.(?:js|mjs|cjs|py|sh|ts)(?:\s|$)/.test(invocation)
  ) {
    return { kind: "script", target: invocation };
  }
  return { kind: "command" };
}

/** Classify canonical details across providers without interpreting opaque shell source. */
export function describeToolActivity(input: {
  detail: ToolCallDetail;
  metadata?: Record<string, unknown>;
}): ToolActivity[] {
  const { detail, metadata } = input;
  const changes = parseFileChanges(metadata?.fileChanges);
  if (changes && (detail.type === "edit" || detail.type === "write" || detail.type === "unknown")) {
    return changes.map((file) => {
      const kinds = {
        add: "create",
        update: "edit",
        delete: "delete",
        write: "write",
        unknown: "change",
      } as const;
      return { kind: kinds[file.kind], target: file.path };
    });
  }
  switch (detail.type) {
    case "read":
    case "edit":
    case "write":
      return [{ kind: detail.type, target: detail.filePath }];
    case "search":
      return [{ kind: "search", target: detail.query }];
    case "shell": {
      const actions = parseCommandActions(metadata?.commandActions);
      if (!actions) return [commandActivity(detail.command)];
      return actions.map((action) => {
        switch (action.type) {
          case "read":
            return { kind: "read", target: action.path };
          case "listFiles":
            return { kind: "list", target: action.path ?? undefined };
          case "search":
            return { kind: "search", target: action.query ?? action.path ?? undefined };
          case "unknown":
            return commandActivity(action.command);
        }
      });
    }
    default:
      return [];
  }
}
