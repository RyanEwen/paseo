import { isWeb } from "@/constants/platform";
import { resolveActualPromptPin } from "./actual-prompt-pin-model";

/** Original wrapper coordinates survive translation of the one real content node.
 * Message jumps and reading geometry must use this rather than the pinned ink top.
 */
export function getOriginalPromptTop(element: HTMLElement): number {
  if (!isWeb) return 0;
  const row = element.closest<HTMLElement>("[data-history-row-id]");
  const translatedBody = element.closest("[data-actual-prompt-content]");
  const translation = translatedBody ? Number(row?.dataset.promptTranslation ?? 0) : 0;
  return element.getBoundingClientRect().top - translation;
}

/** Called by the viewport's existing scroll/layout owner, not another scroll listener.
 * Wrappers retain their original flow/virtual measurement; only their real child moves.
 */
export function syncActualPromptPin(
  content: HTMLElement,
  viewport: HTMLElement,
  enabled: boolean,
): string | null {
  if (!isWeb) return null;
  const viewportTop = viewport.getBoundingClientRect().top;
  const rows = Array.from(content.querySelectorAll<HTMLElement>("[data-actual-prompt-row]"));
  const geometry = rows.map((row) => {
    const bounds = row.getBoundingClientRect();
    return {
      id: row.dataset.historyRowId!,
      top: bounds.top - viewportTop + viewport.scrollTop,
      height: bounds.height,
    };
  });
  const pin = enabled
    ? resolveActualPromptPin(
        geometry.filter((row) => row.height > 0),
        viewport.scrollTop,
      )
    : null;
  for (const row of rows) {
    const body = row.querySelector<HTMLElement>("[data-actual-prompt-content]");
    if (!body) continue;
    const active = row.dataset.historyRowId === pin?.id;
    const translation = active ? pin!.translateY : 0;
    row.dataset.promptTranslation = String(translation);
    row.dataset.promptPinned = active ? "true" : "false";
    row.style.zIndex = active ? "2" : "";
    body.style.transform = translation === 0 ? "" : `translateY(${translation}px)`;
  }
  return pin?.id ?? null;
}
