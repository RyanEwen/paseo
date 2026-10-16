import { z } from "zod";

const ActionSchema = z.object({ default_popup: z.string().optional() });
const ManifestSchema = z.object({
  action: ActionSchema.optional(),
  browser_action: ActionSchema.optional(),
  page_action: ActionSchema.optional(),
});

/** Resolve only a popup packaged inside this extension, never a remote or sibling origin. */
export function getExtensionPopupUrl(id: string, manifest: unknown): string | null {
  const parsed = ManifestSchema.safeParse(manifest);
  if (!parsed.success) {
    return null;
  }
  const action = parsed.data.action ?? parsed.data.browser_action ?? parsed.data.page_action;
  const popup = action?.default_popup;
  if (!popup) {
    return null;
  }
  if (!URL.canParse(popup, `chrome-extension://${id}/`)) {
    return null;
  }
  const url = new URL(popup, `chrome-extension://${id}/`);
  if (url.protocol !== "chrome-extension:" || url.hostname !== id) {
    return null;
  }
  return url.href;
}
