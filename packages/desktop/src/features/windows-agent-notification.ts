import { buildAgentDeepLink, parseAgentDeepLink } from "@getpaseo/protocol/agent-deep-link";

interface WindowsAgentNotificationInput {
  notificationId: string;
  title: string;
  body: string | undefined;
  data: Record<string, unknown> | undefined;
  iconPath: string | null;
  silent: boolean;
}

/** XML 1.0 allows whitespace controls and valid Unicode, but rejects lone surrogates. */
function isXmlCharacter(character: string): boolean {
  if (character.length === 2) {
    return true;
  }
  const code = character.charCodeAt(0);
  const isWhitespace = code === 0x09 || code === 0x0a || code === 0x0d;
  const isBeforeSurrogates = code >= 0x20 && code <= 0xd7ff;
  const isAfterSurrogates = code >= 0xe000 && code <= 0xfffd;
  return isWhitespace || isBeforeSurrogates || isAfterSurrogates;
}

function escapeXml(value: string): string {
  // Provider text can contain terminal control characters, which XML rejects.
  const xmlText = Array.from(value).filter(isXmlCharacter).join("");
  return xmlText
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** Embed the stable chat URL in the toast so activation survives renderer reloads and app restarts. */
export function buildWindowsAgentToast(input: WindowsAgentNotificationInput): string | null {
  const serverId = input.data?.serverId;
  const agentId = input.data?.agentId;
  if (typeof serverId !== "string" || typeof agentId !== "string") {
    return null;
  }
  if (!serverId.trim() || !agentId.trim()) {
    return null;
  }

  // The tag lets Electron also dispatch the instance click event so its
  // retained notification can be released. The URL survives process restarts.
  const launchArguments = new URLSearchParams({
    type: "click",
    tag: input.notificationId,
    paseoAgent: buildAgentDeepLink({ serverId, agentId }),
  });
  const launch = escapeXml(launchArguments.toString());
  const body = input.body ? `<text>${escapeXml(input.body)}</text>` : "";
  const icon = input.iconPath
    ? `<image placement="appLogoOverride" hint-crop="none" src="${escapeXml(input.iconPath)}"/>`
    : "";
  const audio = input.silent ? '<audio silent="true"/>' : "";
  return `<toast launch="${launch}" activationType="foreground"><visual><binding template="ToastGeneric"><text>${escapeXml(input.title)}</text>${body}${icon}</binding></visual>${audio}</toast>`;
}

/** Only accept Paseo chat activations, leaving other Windows notification actions alone. */
export function openWindowsAgentNotification(
  input: { type: string; arguments: string },
  openAgentLink: (url: string) => void,
): void {
  if (input.type !== "click") {
    return;
  }
  const link = new URLSearchParams(input.arguments).get("paseoAgent");
  if (!link || !parseAgentDeepLink(link)) {
    return;
  }
  openAgentLink(link);
}

/** A timed-out Windows banner is still available to click in Notification Center. */
export function shouldRetainWindowsNotification(reason: string | undefined): boolean {
  return reason === "timedOut";
}

interface WindowsNotificationRetentionInput<T> {
  notifications: ReadonlySet<T>;
  getDeliveredIds(): Promise<ReadonlySet<string>>;
  release(notification: T): void;
  onHistoryError(error: unknown): void;
}

/** Release expired banners only after Windows confirms their Center entries were removed. */
export async function pruneRemovedWindowsNotifications<T extends { id: string }>(
  input: WindowsNotificationRetentionInput<T>,
): Promise<void> {
  if (input.notifications.size === 0) {
    return;
  }
  // A banner can expire while history is being read. Only inspect candidates
  // that were already expired when the request began.
  const candidates = [...input.notifications];
  try {
    const deliveredIds = await input.getDeliveredIds();
    for (const notification of candidates) {
      if (!deliveredIds.has(notification.id)) {
        input.release(notification);
      }
    }
  } catch (error) {
    // A history failure must not remove a still-clickable Center entry.
    input.onHistoryError(error);
  }
}
