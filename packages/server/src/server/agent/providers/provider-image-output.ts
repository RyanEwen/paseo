import { createHash } from "node:crypto";
import * as fsSync from "node:fs";
import os from "node:os";
import path from "node:path";

import type { AgentTimelineItem } from "../agent-sdk-types.js";

export interface ProviderImageOutput {
  path?: string | null;
  url?: string | null;
  data?: string | null;
  mimeType?: string | null;
  altText?: string | null;
}

export interface MaterializedProviderImage {
  path: string;
}

const PROVIDER_IMAGE_ATTACHMENT_DIR = "paseo-attachments";
const PROVIDER_IMAGE_ATTACHMENT_DIR_PREFIX = `${PROVIDER_IMAGE_ATTACHMENT_DIR}-`;
const PRIVATE_ATTACHMENT_DIR_MODE = 0o700;
const MATERIALIZED_IMAGE_FILE_MODE = 0o600;
export const PROVIDER_IMAGE_MAX_BYTES = 16 * 1024 * 1024;
export const PROVIDER_IMAGE_MAX_BASE64_LENGTH = Math.ceil(PROVIDER_IMAGE_MAX_BYTES / 3) * 4;
const PROVIDER_IMAGE_MAX_INPUT_LENGTH = PROVIDER_IMAGE_MAX_BASE64_LENGTH + 256;

export class ProviderImageInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderImageInputError";
  }
}

function assertImageInputLength(data: string): void {
  // Check the original string before trim, regex, slicing or base64 allocation.
  if (data.length > PROVIDER_IMAGE_MAX_INPUT_LENGTH) {
    throw new ProviderImageInputError("Image input exceeds the 16 MiB attachment limit.");
  }
}

function assertProviderImageInputLengths(image: ProviderImageOutput): void {
  for (const value of [image.data, image.path, image.url]) {
    if (value) assertImageInputLength(value);
  }
}

let materializedImageAttachmentDir: string | null = null;

function canReuseMaterializedImageAttachmentDir(dir: string): boolean {
  try {
    const stats = fsSync.lstatSync(dir);
    if (!stats.isDirectory()) {
      return false;
    }
    fsSync.chmodSync(dir, PRIVATE_ATTACHMENT_DIR_MODE);
    return true;
  } catch {
    return false;
  }
}

function getMaterializedImageAttachmentDir(): string {
  if (
    materializedImageAttachmentDir &&
    canReuseMaterializedImageAttachmentDir(materializedImageAttachmentDir)
  ) {
    return materializedImageAttachmentDir;
  }

  materializedImageAttachmentDir = fsSync.mkdtempSync(
    path.join(os.tmpdir(), PROVIDER_IMAGE_ATTACHMENT_DIR_PREFIX),
  );
  fsSync.chmodSync(materializedImageAttachmentDir, PRIVATE_ATTACHMENT_DIR_MODE);
  return materializedImageAttachmentDir;
}

function getImageExtension(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/bmp":
      return "bmp";
    case "image/tiff":
      return "tiff";
    default:
      return "bin";
  }
}

function normalizeImageData(mimeType: string, data: string): { mimeType: string; data: string } {
  assertImageInputLength(data);
  const trimmed = data.trim();
  if (trimmed.startsWith("data:")) {
    const comma = trimmed.indexOf(",");
    if (comma < 0 || comma > 255) {
      throw new ProviderImageInputError("Image data URL has an invalid header.");
    }
    const header = trimmed.slice(0, comma);
    const match = /^data:(image\/[a-z0-9.+-]+);base64$/i.exec(header);
    if (!match) {
      throw new ProviderImageInputError("Image data URL must contain base64 image data.");
    }
    return { mimeType: match[1].toLowerCase(), data: trimmed.slice(comma + 1) };
  }
  return { mimeType: mimeType.toLowerCase(), data: trimmed };
}

function decodeImageData(data: string): Buffer {
  if (data.length > PROVIDER_IMAGE_MAX_BASE64_LENGTH) {
    throw new ProviderImageInputError("Image input exceeds the 16 MiB attachment limit.");
  }
  const paddingStart = data.indexOf("=");
  const bodyLength = paddingStart < 0 ? data.length : paddingStart;
  const paddingLength = data.length - bodyLength;
  const body = data.slice(0, bodyLength);
  const invalidPadding =
    paddingLength > 0 &&
    (paddingLength > 2 || data.length % 4 !== 0 || !/^={1,2}$/.test(data.slice(bodyLength)));
  if (bodyLength === 0 || bodyLength % 4 === 1 || invalidPadding || /[^A-Za-z0-9+/]/.test(body)) {
    throw new ProviderImageInputError("Image contains invalid base64 data.");
  }
  const remainder = bodyLength % 4;
  const lastDigit = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".indexOf(
    body[bodyLength - 1],
  );
  const invalidPadBits =
    (remainder === 2 && (lastDigit & 15) !== 0) || (remainder === 3 && (lastDigit & 3) !== 0);
  if (invalidPadBits) throw new ProviderImageInputError("Image contains invalid base64 data.");
  const byteLength = Math.floor((bodyLength * 3) / 4);
  if (byteLength > PROVIDER_IMAGE_MAX_BYTES) {
    throw new ProviderImageInputError("Image input exceeds the 16 MiB attachment limit.");
  }
  const bytes = Buffer.from(data, "base64");
  if (bytes.length !== byteLength) {
    throw new ProviderImageInputError("Image contains invalid base64 data.");
  }
  return bytes;
}

function assertImageSignature(bytes: Buffer, mimeType: string): void {
  // These signatures identify the container only; no decoder or frame/pixel safety is implied.
  let matches = false;
  switch (mimeType) {
    case "image/png":
      matches = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      break;
    case "image/jpeg":
      matches = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      break;
    case "image/gif":
      matches = ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6));
      break;
    case "image/webp":
      matches =
        bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
      break;
    case "image/bmp":
      matches = bytes[0] === 0x42 && bytes[1] === 0x4d;
      break;
    case "image/tiff":
      matches =
        bytes.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 42, 0])) ||
        bytes.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0, 42])) ||
        bytes.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 43, 0])) ||
        bytes.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0, 43]));
      break;
    default:
      throw new ProviderImageInputError("Image attachment format is unsupported.");
  }
  if (!matches) {
    throw new ProviderImageInputError("Image attachment does not match its declared format.");
  }
}

// Filenames are a content hash of the bytes so re-materializing the same image
// within a process reuses the existing temp file instead of leaking a fresh one
// for repeated image blocks or history replay.
export function materializeProviderImage(image: {
  data: string;
  mimeType: string | null;
}): MaterializedProviderImage {
  const admitted = admitProviderImage(image);
  const attachmentsDir = getMaterializedImageAttachmentDir();
  const extension = getImageExtension(admitted.mimeType);
  const filePath = path.join(attachmentsDir, `${admitted.sha256}.${extension}`);
  fsSync.writeFileSync(filePath, admitted.bytes, { mode: MATERIALIZED_IMAGE_FILE_MODE });
  fsSync.chmodSync(filePath, MATERIALIZED_IMAGE_FILE_MODE);
  return { path: filePath };
}

export interface AdmittedProviderImage {
  bytes: Buffer;
  mimeType: string;
  sha256: string;
}

export function admitProviderImage(image: {
  data: string;
  mimeType: string | null;
}): AdmittedProviderImage {
  const normalized = normalizeImageData(image.mimeType ?? "image/png", image.data);
  const bytes = decodeImageData(normalized.data);
  assertImageSignature(bytes, normalized.mimeType);
  return {
    bytes,
    mimeType: normalized.mimeType,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

// Recognizes markdown rendered for a materialized provider image: its source is a content-hashed
// file in the attachments dir. Matching the full <hash>.<ext> shape (not just a leading "![")
// keeps user-authored text from being mistaken for a provider image during history replay. The
// separator still accepts old doubled-backslash Windows history; new Windows output uses file URIs.
const PROVIDER_IMAGE_MARKDOWN = new RegExp(
  `^!\\[[^\\]]*\\]\\([^)]*${PROVIDER_IMAGE_ATTACHMENT_DIR}(?:-[^/\\\\)]+)?[/\\\\]+(?:[^/\\\\)]+[/\\\\]+)?[0-9a-f]{64}\\.[a-z0-9]+\\)`,
);

export function isProviderImageMarkdown(text: string): boolean {
  return PROVIDER_IMAGE_MARKDOWN.test(text);
}

interface RenderProviderImageOutputOptions {
  materialize?: (image: { data: string; mimeType: string | null }) => MaterializedProviderImage;
}

function nonEmptyString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isDataImageSource(source: string): boolean {
  return source.trim().toLowerCase().startsWith("data:image/");
}

function escapeMarkdownImageAlt(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\]/g, "\\]");
}

function encodeFilePath(value: string): string {
  return value
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function windowsFileUri(value: string): string | null {
  const isWindowsNetworkPath = value.startsWith("\\\\");
  let normalizedPath = value.replace(/\\/g, "/");
  if (/^\/\/\?\/UNC\//i.test(normalizedPath)) {
    normalizedPath = `//${normalizedPath.slice(8)}`;
  } else if (/^\/\/\?\/[A-Za-z]:\//.test(normalizedPath)) {
    normalizedPath = normalizedPath.slice(4);
  }

  if (/^[A-Za-z]:\//.test(normalizedPath)) {
    const drive = normalizedPath.slice(0, 2);
    return `file:///${drive}${encodeFilePath(normalizedPath.slice(2))}`;
  }
  if (isWindowsNetworkPath && normalizedPath.startsWith("//")) {
    return `file:${encodeFilePath(normalizedPath)}`;
  }
  return null;
}

function markdownImageSource(value: string): string {
  const windowsUri = windowsFileUri(value);
  if (windowsUri) {
    return windowsUri;
  }
  if (value.startsWith("/")) {
    return `file://${encodeFilePath(value)}`;
  }
  return value;
}

function escapeMarkdownImageSource(value: string): string {
  return markdownImageSource(value).replace(/\\/g, "\\\\").replace(/\)/g, "\\)");
}

export function renderProviderImageOutputAsAssistantMarkdown(
  image: ProviderImageOutput,
  options: RenderProviderImageOutputOptions = {},
): AgentTimelineItem | null {
  try {
    assertProviderImageInputLengths(image);
  } catch (error) {
    if (!(error instanceof ProviderImageInputError)) throw error;
    return { type: "assistant_message", text: `Image output omitted: ${error.message}` };
  }
  const source = nonEmptyString(image.path) ?? nonEmptyString(image.url);
  if (source && !isDataImageSource(source)) {
    const altText = escapeMarkdownImageAlt(nonEmptyString(image.altText) ?? "Image");
    return {
      type: "assistant_message",
      text: `![${altText}](${escapeMarkdownImageSource(source)})`,
    };
  }

  const data = nonEmptyString(image.data) ?? (source && isDataImageSource(source) ? source : null);
  if (!data) {
    return null;
  }

  let materialized: MaterializedProviderImage | null = null;
  try {
    materialized = options.materialize
      ? options.materialize({
          data,
          mimeType: nonEmptyString(image.mimeType),
        })
      : null;
  } catch (error) {
    if (error instanceof ProviderImageInputError) {
      return { type: "assistant_message", text: `Image output omitted: ${error.message}` };
    }
    materialized = null;
  }
  if (!materialized?.path || isDataImageSource(materialized.path)) {
    return {
      type: "assistant_message",
      text: "Image output was omitted because it was not available as a file path or URL.",
    };
  }

  const altText = escapeMarkdownImageAlt(nonEmptyString(image.altText) ?? "Image");
  return {
    type: "assistant_message",
    text: `![${altText}](${escapeMarkdownImageSource(materialized.path)})`,
  };
}
