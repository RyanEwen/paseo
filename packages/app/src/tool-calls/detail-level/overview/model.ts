import { describeToolActivity, type ToolActivity } from "@getpaseo/protocol/tool-call-activity";
import { isPaseoToolName } from "@getpaseo/protocol/tool-name-normalization";
import { describeToolCall, type ToolCallRun } from "../grouping";

const DIRECT_PASEO_TOOL_PREFIX = "paseo_";
const DIRECT_SEARCH_TOOL_SUFFIX_PATTERN = /(?:^|[_.:/])(?:web_search|llm_context)$/;

export interface OverviewSummary {
  editedFileCount: number;
  commandCount: number;
  readFileCount: number;
  searchCount: number;
  otherToolCount: number;
  paseoCallCount: number;
}

export interface OverviewToolCallGroup {
  mode: "overview";
  run: ToolCallRun;
  summary: OverviewSummary;
  isLoading: boolean;
}

function isPaseoCall(name: string, normalizedName: string): boolean {
  return isPaseoToolName(name) || normalizedName.startsWith(DIRECT_PASEO_TOOL_PREFIX);
}

function isSearchCall(name: string): boolean {
  return DIRECT_SEARCH_TOOL_SUFFIX_PATTERN.test(name);
}

/** Count attempted operations, preserving classic counts when descriptive mode is off. */
export function buildOverviewGroup(
  run: ToolCallRun,
  options: { descriptive?: boolean } = {},
): OverviewToolCallGroup {
  const editedFiles = new Set<string>();
  const readFiles = new Set<string>();
  let isLoading = false;
  let commandCount = 0;
  let searchCount = 0;
  let otherToolCount = 0;
  let paseoCallCount = 0;

  for (const call of run.calls) {
    const descriptor = describeToolCall(call);
    const normalizedName = descriptor.name.trim().toLowerCase();
    isLoading ||= descriptor.status === "running" || descriptor.status === "executing";
    if (isPaseoCall(descriptor.name, normalizedName)) {
      paseoCallCount += 1;
      continue;
    }
    const activities = describeToolActivity({
      detail: descriptor.detail,
      metadata: options.descriptive ? descriptor.metadata : undefined,
    });
    if (activities.length === 0) {
      if (isSearchCall(normalizedName)) searchCount += 1;
      else otherToolCount += 1;
      continue;
    }
    const counts = countActivities({ activities, callId: call.id, readFiles, editedFiles });
    commandCount += counts.commands;
    searchCount += counts.searches;
    otherToolCount += counts.other;
  }

  const summary = {
    editedFileCount: editedFiles.size,
    commandCount,
    readFileCount: readFiles.size,
    searchCount,
    otherToolCount,
    paseoCallCount,
  };
  return {
    mode: "overview",
    run,
    isLoading,
    summary,
  };
}

/** Count mixed batches by their proven operations and deduplicate file targets. */
function countActivities({
  activities,
  callId,
  readFiles,
  editedFiles,
}: {
  activities: ToolActivity[];
  callId: string;
  readFiles: Set<string>;
  editedFiles: Set<string>;
}) {
  const counts = { commands: 0, searches: 0, other: 0 };
  for (const activity of activities) {
    switch (activity.kind) {
      case "read":
        readFiles.add(activity.target ?? callId);
        break;
      case "edit":
      case "write":
      case "change":
      case "create":
      case "delete":
        editedFiles.add(activity.target ?? callId);
        break;
      case "search":
        counts.searches += 1;
        break;
      case "list":
        counts.other += 1;
        break;
      case "command":
      case "script":
        counts.commands += 1;
        break;
    }
  }
  return counts;
}
