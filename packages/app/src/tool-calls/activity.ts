import type { TFunction } from "i18next";
import { stripCwdPrefix } from "@getpaseo/protocol/path-utils";
import { describeToolActivity, type ToolActivityKind } from "@getpaseo/protocol/tool-call-activity";
import type { ToolCallDisplayInput } from "@/utils/tool-call-display";

/** Derive localized chrome only; original details remain the copy/expand source. */
export function buildActivityDisplay(input: ToolCallDisplayInput, t: TFunction) {
  if (input.agentMessage) return undefined;
  const activities = describeToolActivity(input);
  if (activities.length === 0) return undefined;
  const first = activities[0];
  const homogeneous = activities.every((activity) => activity.kind === first.kind);
  const fileOperations = activities.every((activity) =>
    ["create", "edit", "write", "delete", "change"].includes(activity.kind),
  );
  let kind: Exclude<ToolActivityKind, "change"> | "activity" | "files" = "activity";
  if (fileOperations && !homogeneous) kind = "files";
  if (homogeneous && first.kind !== "change") kind = first.kind;
  if (first.kind === "change" && homogeneous) kind = "files";
  let state = "intent";
  if (input.status === "completed") state = "completed";
  if (input.status === "running") state = "running";
  let displayName = t(`toolActivity.${kind}.${state}`);
  if (input.status === "failed" || input.status === "canceled") {
    displayName = t(`toolActivity.${input.status}`, { action: displayName });
  }
  const targets = activities.flatMap((activity) => {
    if (!activity.target) return [];
    const isPath = ["read", "edit", "write", "create", "delete", "change", "list"].includes(
      activity.kind,
    );
    return [isPath ? stripCwdPrefix(activity.target, input.cwd) : activity.target];
  });
  const summary = [...new Set(targets)].join(", ");
  return { displayName, summary: summary || undefined, kind };
}
