import { parseFileChanges } from "@getpaseo/protocol/tool-call-activity";
import type { TFunction } from "i18next";
import { buildActivityDisplay } from "./activity";
import type { AgentMessage } from "@getpaseo/protocol/agent-message";
import { buildAgentMessageDisplay } from "@getpaseo/protocol/agent-message-display";
import type { PlanOutcome } from "@/components/plan-card";
import type { ComponentType } from "react";
import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import type { ToolCallDisplayInput } from "@/utils/tool-call-display";
import { buildToolCallDisplayModel } from "@/utils/tool-call-display";
import { extractToolCallFilePath } from "@/utils/extract-tool-call-file-path";
import {
  hasMeaningfulToolCallDetail,
  isPendingToolCallDetail,
} from "@/utils/tool-call-detail-state";

type ToolCallStatus = "executing" | "running" | "completed" | "failed" | "canceled";
export type ToolCallPresentationIcon = ComponentType<{ size?: number; color?: string }>;

interface BuildToolCallPresentationInput {
  agentMessage?: AgentMessage;
  toolName: string;
  status: ToolCallStatus;
  error: unknown;
  detail?: ToolCallDetail;
  cwd?: string;
  metadata?: Record<string, unknown>;
  resolveIcon: ToolCallIconResolver;
  activityTranslation?: TFunction;
}

export interface ToolCallPresentation {
  detail: ToolCallDetail | undefined;
  displayName: string;
  summary?: string;
  errorText?: string;
  icon: ToolCallPresentationIcon;
  isLoadingDetails: boolean;
  hasDetails: boolean;
  canOpenDetails: boolean;
  openFilePath: string | null;
  isPlan: boolean;
  planOutcome?: PlanOutcome;
}

export type ToolCallIconResolver = (
  toolName: string,
  detail: ToolCallDetail | undefined,
) => ToolCallPresentationIcon;

function displayStatus(status: ToolCallStatus): ToolCallDisplayInput["status"] {
  return status === "executing" ? "running" : status;
}

function displayDetail(detail: ToolCallDetail | undefined): ToolCallDetail {
  return detail ?? { type: "unknown", input: null, output: null };
}

/** Build one row/detail policy; an absent translator retains classic tool labels. */
export function buildToolCallPresentation(
  input: BuildToolCallPresentationInput,
): ToolCallPresentation {
  const sourceDetail = input.agentMessage
    ? buildAgentMessageDisplay(input.agentMessage).detail
    : input.detail;
  const detail = detailForExpansion(sourceDetail, input);
  const detailForDisplay = displayDetail(sourceDetail);
  const displayModel = buildToolCallDisplayModel({
    name: input.toolName,
    agentMessage: input.agentMessage,
    status: displayStatus(input.status),
    error: input.error ?? null,
    detail: detailForDisplay,
    metadata: input.metadata,
    cwd: input.cwd,
  });
  const activity = input.activityTranslation
    ? buildActivityDisplay(
        {
          name: input.toolName,
          agentMessage: input.agentMessage,
          status: displayStatus(input.status),
          error: input.error,
          detail: detailForDisplay,
          metadata: input.metadata,
          cwd: input.cwd,
        },
        input.activityTranslation,
      )
    : undefined;
  const iconDetail = activityIconDetail(sourceDetail, activity?.kind);
  const isLoadingDetails = isPendingToolCallDetail({
    detail,
    status: input.status,
    error: input.error,
  });
  const hasDetails = Boolean(input.error) || hasMeaningfulToolCallDetail(detail);

  return {
    detail,
    displayName: activity?.displayName ?? displayModel.displayName,
    summary: activity ? activity.summary : displayModel.summary,
    errorText: displayModel.errorText,
    icon: input.resolveIcon(input.toolName, iconDetail),
    isLoadingDetails,
    hasDetails,
    canOpenDetails: hasDetails || isLoadingDetails,
    openFilePath: extractToolCallFilePath(detail),
    isPlan: input.detail?.type === "plan",
    planOutcome: input.detail?.type === "plan" ? resolvePlanOutcome(input) : undefined,
  };
}

function resolvePlanOutcome(input: BuildToolCallPresentationInput): PlanOutcome | undefined {
  if (input.status === "canceled") return "canceled";
  if (input.metadata?.approved === false) return "rejected";
  if (input.metadata?.approved === true) return "approved";
  if (input.status === "running" || input.status === "executing") return "pending";
  return undefined;
}

/** Keep the complete source patch batch inspectable without inventing new wire details. */
function detailForExpansion(
  source: ToolCallDetail | undefined,
  input: BuildToolCallPresentationInput,
): ToolCallDetail | undefined {
  if (input.agentMessage) return source;
  const files = parseFileChanges(input.metadata?.fileChanges);
  if (!files || files.length < 2) return source;
  return {
    type: "unknown",
    input: { files: files.map(({ path, kind }) => ({ path, kind })) },
    output: { files },
  };
}

/** Shell read/search activities use the same icon as canonical provider details. */
function activityIconDetail(
  source: ToolCallDetail | undefined,
  kind: NonNullable<ReturnType<typeof buildActivityDisplay>>["kind"] | undefined,
): ToolCallDetail | undefined {
  if (kind === "read" || kind === "list") return { type: "read", filePath: "" };
  if (kind === "files") return { type: "edit", filePath: "" };
  if (kind === "search") return { type: "search", query: "" };
  return source;
}
