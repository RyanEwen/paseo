import type { TextLayoutEvent } from "react-native";
import {
  PromptBubbleGeometryContext,
  PromptPixelOwnerContext,
  type PromptBubbleNode,
} from "./prompt-bubble-geometry";
import { memo, useMemo, useCallback, useContext, type ComponentProps } from "react";
import { UserMessage } from "@/components/message";
import { PromptNavigationActions } from "./prompt-navigation-actions";

/** Attach viewport-owned navigation without changing the shared message renderer's identity. */
export const PromptUserMessage = memo(function PromptUserMessage({
  timelineMessageId,
  ...props
}: ComponentProps<typeof UserMessage> & { timelineMessageId: string }) {
  const pixelOwner = useContext(PromptPixelOwnerContext);
  const copyMask = pixelOwner?.id === timelineMessageId ? pixelOwner : undefined;
  const geometry = useContext(PromptBubbleGeometryContext);
  const registerBubble = useCallback(
    (node: PromptBubbleNode | null) => {
      geometry?.register(timelineMessageId, node);
      // Attachment-only messages have no Text layout event. Their measured text
      // prefix is explicitly empty rather than waiting for an event that cannot fire.
      if (node && props.message.trim().length === 0) {
        geometry?.onTextLayout(timelineMessageId, []);
      }
    },
    [geometry, timelineMessageId, props.message],
  );
  const onBubbleLayout = useCallback(() => geometry?.onLayout(), [geometry]);
  const onBubbleTextLayout = useCallback(
    (event: TextLayoutEvent) => geometry?.onTextLayout(timelineMessageId, event.nativeEvent.lines),
    [geometry, timelineMessageId],
  );
  const actions = useMemo(
    () => <PromptNavigationActions messageId={timelineMessageId} />,
    [timelineMessageId],
  );
  return (
    <UserMessage
      {...props}
      copyMask={copyMask}
      onBubbleTextLayout={geometry ? onBubbleTextLayout : undefined}
      bubbleRef={geometry ? registerBubble : undefined}
      onBubbleLayout={geometry ? onBubbleLayout : undefined}
      navigationActions={actions}
    />
  );
});
