import { z } from "zod";

export const AttachmentOwnerSchema = z.string().min(1).max(128);
export const AttachmentIdSchema = z.string().regex(/^att_[0-9a-f-]{36}$/);
export const AttachmentReferenceSchema = z.object({
  id: AttachmentIdSchema,
  agentId: AttachmentOwnerSchema,
  workspaceId: z.string().min(1).max(256).optional(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  byteLength: z
    .number()
    .int()
    .positive()
    .max(16 * 1024 * 1024),
  mimeType: z.enum([
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/bmp",
    "image/tiff",
  ]),
  createdAt: z.string().min(1).max(64),
});
export type AttachmentReference = z.infer<typeof AttachmentReferenceSchema>;

const requestId = z.string().min(1).max(128);
const error = z.string().max(512).nullable();
export const AttachmentListRequestSchema = z.object({
  type: z.literal("attachments.list.request"),
  agentId: AttachmentOwnerSchema,
  after: AttachmentIdSchema.optional(),
  limit: z.number().int().min(1).max(50).optional(),
  requestId,
});
export const AttachmentGetRequestSchema = z.object({
  type: z.literal("attachments.get.request"),
  agentId: AttachmentOwnerSchema,
  referenceId: AttachmentIdSchema,
  requestId,
});
export const AttachmentReadRequestSchema = z.object({
  type: z.literal("attachments.read.request"),
  agentId: AttachmentOwnerSchema,
  referenceId: AttachmentIdSchema,
  requestId,
});
export const AttachmentReadCancelRequestSchema = z.object({
  type: z.literal("attachments.read.cancel.request"),
  readRequestId: requestId,
  requestId,
});
export const AttachmentReadCancelResponseSchema = z.object({
  type: z.literal("attachments.read.cancel.response"),
  payload: z.object({ canceled: z.boolean(), error, requestId }),
});
export const AttachmentListResponseSchema = z.object({
  type: z.literal("attachments.list.response"),
  payload: z.object({
    references: z.array(AttachmentReferenceSchema).max(50),
    next: AttachmentIdSchema.nullable(),
    error,
    requestId,
  }),
});
export const AttachmentGetResponseSchema = z.object({
  type: z.literal("attachments.get.response"),
  payload: z.object({ reference: AttachmentReferenceSchema.nullable(), error, requestId }),
});
// Original bytes use FileBegin/Chunk/End framing; this terminal reply certifies the read/hash.
export const AttachmentReadResponseSchema = z.object({
  type: z.literal("attachments.read.response"),
  payload: z.object({ reference: AttachmentReferenceSchema.nullable(), error, requestId }),
});
