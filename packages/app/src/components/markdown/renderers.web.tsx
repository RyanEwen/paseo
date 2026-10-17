import { Text } from "react-native";
import { forwardRef, useMemo, type ComponentProps } from "react";
import type {
  CodeBlockRendererProps,
  LinkRendererProps,
  MarkdownRenderers,
} from "react-native-enriched-markdown";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useFileLink } from "@/assistant-file-links";
import { useAssistantFileLinkResolverContext } from "@/assistant-file-links/provider";
import { classifyForResolution } from "@/assistant-file-links/resolver";
import { WorkspaceHttpLinkMenu } from "@/workspace/browser/link-menu";
import { isHttpUrl } from "@/utils/http-url";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { HighlightedCodeBlock } from "@/components/highlighted-code-block";
import type { Theme } from "@/styles/theme";
import { MermaidFence } from "./fence/mermaid";
import { markdownLinkSource } from "./source";

const ThemedCodeBlock = withUnistyles(HighlightedCodeBlock);
const codeStyle = (theme: Theme) => ({
  inheritedStyles: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
  },
  textStyle: { backgroundColor: theme.colors.surface2, padding: 12, borderRadius: 8 },
});
function WebCodeBlock({ code, language }: CodeBlockRendererProps) {
  if (language?.toLowerCase() === "mermaid") return <MermaidFence code={code} />;
  return <ThemedCodeBlock code={code} language={language} uniProps={codeStyle} />;
}

function WebLink({ link, anchorProps, children }: LinkRendererProps) {
  const source = markdownLinkSource(link.url, link.sourceType);
  const { tooltipPath, onHoverIn } = useFileLink(source);
  const { configRef, httpLinkDestination } = useAssistantFileLinkResolverContext();
  const resolution = classifyForResolution(source, {
    workspaceRoot: configRef.current.workspaceRoot,
  });
  const menuUrl =
    resolution.kind === "resolved" &&
    resolution.value.kind === "external" &&
    isHttpUrl(resolution.value.url)
      ? resolution.value.url
      : undefined;
  const anchorStyle = useMemo(
    () => ({ ...anchorProps.style, overflowWrap: "anywhere" as const }),
    [anchorProps.style],
  );
  const anchor = (
    <a {...anchorProps} style={anchorStyle}>
      {children}
    </a>
  );
  return (
    <WorkspaceHttpLinkMenu
      inline
      url={menuUrl}
      defaultDestination={configRef.current.onOpenHttpUrl ? httpLinkDestination : "external"}
    >
      <Tooltip delayDuration={400}>
        <TooltipTrigger asChild onHoverIn={onHoverIn}>
          <InlineLinkTrigger>{anchor}</InlineLinkTrigger>
        </TooltipTrigger>
        {tooltipPath ? (
          <TooltipContent side="top" align="start" maxWidth={520}>
            <Text selectable={false} style={styles.tooltipPath}>
              {tooltipPath}
            </Text>
          </TooltipContent>
        ) : null}
      </Tooltip>
    </WorkspaceHttpLinkMenu>
  );
}
// TooltipTrigger also supplies native Pressable handlers; forward only DOM events.
// A View renders a div, which is invalid inside the library's prose paragraphs.
const InlineLinkTrigger = forwardRef<HTMLSpanElement, ComponentProps<"span">>(
  function InlineLinkTrigger({ children, onMouseEnter, onMouseLeave, onFocus, onBlur }, ref) {
    return (
      <span
        ref={ref}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onFocus={onFocus}
        onBlur={onBlur}
      >
        {children}
      </span>
    );
  },
);
const styles = StyleSheet.create((theme) => ({
  tooltipPath: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
}));

export const WEB_RENDERERS: MarkdownRenderers = { codeBlock: WebCodeBlock, link: WebLink };
