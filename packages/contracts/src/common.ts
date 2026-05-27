import { Cursor, PositiveInteger } from "./primitives.js";
import { z } from "./zod.js";

export const ErrorCode = z.enum([
  "api_key_not_found",
  "api_key_revoked",
  "artifact_not_found",
  "database_unavailable",
  "draft_revision_conflict",
  "entrypoint_not_in_revision",
  "file_count_cap_exceeded",
  "file_size_cap_exceeded",
  "forbidden",
  "idempotency_in_flight",
  "invalid_auth",
  "invalid_content_length",
  "invalid_cursor",
  "invalid_idempotency_key",
  "invalid_request",
  "not_authenticated",
  "not_found",
  "pinned_artifact_cap_exceeded",
  "rate_limited_actor",
  "rate_limited_artifact",
  "rate_limited_workspace",
  "revision_retained",
  "revision_size_cap_exceeded",
  "revision_unpublished",
  "storage_unavailable",
  "unexpected_upload_object",
  "upload_incomplete",
  "upload_session_expired",
  "upload_session_not_found",
  "usage_policy_exceeded",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ErrorEnvelope = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    docs: z.string().url().optional(),
    request_id: z.string().min(1).optional(),
  }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;

export const PaginationRequest = z.object({
  cursor: Cursor.optional(),
  limit: PositiveInteger.max(100).default(50),
});
export type PaginationRequest = z.infer<typeof PaginationRequest>;

export const PageInfo = z.object({
  next_cursor: Cursor.nullable(),
  has_more: z.boolean(),
});
export type PageInfo = z.infer<typeof PageInfo>;

export const EmptyObject = z.object({}).strict();
export type EmptyObject = z.infer<typeof EmptyObject>;

export const Mebibytes = {
  ten: 10 * 1024 * 1024,
  twentyFive: 25 * 1024 * 1024,
} as const;

export const Seconds = {
  oneDay: 24 * 60 * 60,
  thirtyDays: 30 * 24 * 60 * 60,
  ninetyDays: 90 * 24 * 60 * 60,
} as const;
