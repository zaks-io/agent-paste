import { ErrorCode as ErrorCodeSchema } from "../common.js";
import { z } from "../zod.js";

export const McpProtocolErrorCode = z.enum([
  "invalid_token",
  "insufficient_scope",
  "invalid_params",
  "internal_error",
  "method_not_found",
]);
export type McpProtocolErrorCode = z.infer<typeof McpProtocolErrorCode>;

export const McpToolErrorCode = z.enum([...ErrorCodeSchema.options, ...McpProtocolErrorCode.options]);
export type McpToolErrorCode = z.infer<typeof McpToolErrorCode>;

export const mcpToolErrorGroups = {
  publishChain: [
    "invalid_request",
    "artifact_not_found",
    "draft_revision_conflict",
    "entrypoint_not_in_revision",
    "file_count_cap_exceeded",
    "file_size_cap_exceeded",
    "idempotency_in_flight",
    "invalid_idempotency_key",
    "revision_retained",
    "revision_size_cap_exceeded",
    "revision_unpublished",
    "storage_unavailable",
    "unexpected_upload_object",
    "upload_incomplete",
    "upload_session_expired",
    "upload_session_not_found",
    "usage_policy_exceeded",
    "write_allowance_exceeded",
    "revision_ceiling_exceeded",
    "rate_limited_actor",
    "rate_limited_workspace",
    "database_unavailable",
  ] as const satisfies readonly McpToolErrorCode[],
  read: [
    "forbidden",
    "not_found",
    "artifact_not_found",
    "revision_retained",
    "revision_unpublished",
    "invalid_cursor",
    "rate_limited_actor",
    "database_unavailable",
  ] as const satisfies readonly McpToolErrorCode[],
  shareLink: [
    "forbidden",
    "not_found",
    "artifact_not_found",
    "invalid_request",
    "rate_limited_actor",
    "database_unavailable",
  ] as const satisfies readonly McpToolErrorCode[],
};

export const MCP_API_ERROR_HTTP_STATUS: Partial<Record<(typeof ErrorCodeSchema.options)[number], number>> = {
  not_authenticated: 401,
  invalid_auth: 401,
  forbidden: 403,
  invalid_request: 400,
  invalid_cursor: 400,
  invalid_idempotency_key: 400,
  invalid_content_length: 400,
  artifact_not_found: 404,
  not_found: 404,
  revision_unpublished: 404,
  upload_session_not_found: 404,
  api_key_not_found: 404,
  idempotency_in_flight: 409,
  draft_revision_conflict: 409,
  revision_retained: 410,
  usage_policy_exceeded: 429,
  write_allowance_exceeded: 429,
  revision_ceiling_exceeded: 429,
  rate_limited_actor: 429,
  rate_limited_workspace: 429,
  rate_limited_artifact: 429,
  database_unavailable: 503,
  storage_unavailable: 503,
};
