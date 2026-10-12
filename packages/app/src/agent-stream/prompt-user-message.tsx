import { memo, useMemo, type ComponentProps } from "react";
import { UserMessage } from "@/components/message";
import { PromptNavigationActions } from "./prompt-navigation-actions";

/** Attach viewport-owned navigation without changing the shared message renderer's identity. */
export const PromptUserMessage = memo(function PromptUserMessage({
  timelineMessageId,
  ...props
}: ComponentProps<typeof UserMessage> & { timelineMessageId: string }) {
  const actions = useMemo(
    () => <PromptNavigationActions messageId={timelineMessageId} />,
    [timelineMessageId],
  );
  return <UserMessage {...props} navigationActions={actions} />;
});
