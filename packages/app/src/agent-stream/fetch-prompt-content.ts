import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { hydrateStreamState } from "@/types/stream";
import type { UserPrompt } from "./sticky-prompt-model";

/** Fetch one indexed prompt without applying a viewport window; decode it with the
 * same canonical renderer input as the transcript, including attachment metadata.
 */
export async function fetchPromptContent(
  client: DaemonClient,
  agentId: string,
  epoch: string,
  seq: number,
): Promise<UserPrompt> {
  const page = await client.fetchAgentTimeline(agentId, {
    direction: "before",
    cursor: { epoch, seq: seq + 1 },
    limit: 1,
    projection: "projected",
  });
  if (page.error || page.epoch !== epoch || page.reset || page.staleCursor)
    throw new Error("Prompt content is unavailable");
  const entry = page.entries.find(
    (candidate) => candidate.seqEnd === seq && candidate.item.type === "user_message",
  );
  if (!entry) throw new Error("Prompt content is unavailable");
  return hydratePromptEntry(entry, epoch);
}

/** Decode canonical prompt content with the transcript renderer, preserving attachments. */
export function hydratePromptEntry(
  entry: import("./fetch-reading-prompt-context").ContextEntry,
  epoch: string,
): UserPrompt {
  const item = hydrateStreamState(
    [
      {
        event: {
          type: "timeline",
          provider: entry.provider,
          item: entry.item,
          turnId: entry.turnId,
        },
        timestamp: new Date(entry.timestamp),
        timelineCursor: { epoch, seq: entry.seqEnd },
      },
    ],
    { source: "canonical" },
  ).find((candidate): candidate is UserPrompt => candidate.kind === "user_message");
  if (!item) throw new Error("Prompt content is unavailable");
  return item;
}
