import { z } from "zod";
import { Cursor, IsoDateTime, PositiveInteger } from "./primitives.js";

export const ErrorCode = z.enum([
  "access_link_lockdown_active",
  "api_key_expired",
  "api_key_not_found",
  "api_key_revoked",
  "artifact_deleted",
  "artifact_locked",
  "artifact_not_found",
  "database_unavailable",
  "draft_revision_conflict",
  "entrypoint_not_in_revision",
  "file_count_cap_exceeded",
  "file_size_cap_exceeded",
  "idempotency_in_flight",
  "insufficient_scope",
  "invalid_auth",
  "invalid_content_length",
  "invalid_cursor",
  "invalid_idempotency_key",
  "invalid_request",
  "not_authenticated",
  "not_found",
  "platform_lockdown_active",
  "rate_limited_artifact",
  "rate_limited_actor",
  "rate_limited_workspace",
  "render_mode_incompatible",
  "revision_not_found",
  "revision_retained",
  "revision_size_cap_exceeded",
  "revision_unpublished",
  "unauthorized",
  "unexpected_upload_object",
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
    request_id: z.string().min(1),
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

export const RequestMetadata = z.object({
  request_id: z.string().min(1),
  generated_at: IsoDateTime,
});
export type RequestMetadata = z.infer<typeof RequestMetadata>;

export const EmptyObject = z.object({}).strict();
export type EmptyObject = z.infer<typeof EmptyObject>;
