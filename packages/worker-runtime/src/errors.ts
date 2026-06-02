import { buildErrorBody, getRequestId, REQUEST_ID_HEADER } from "@agent-paste/auth";
import { ErrorCode, type ErrorCode as ErrorCodeValue } from "@agent-paste/contracts";
import type { Context, Env } from "hono";

export const ERROR_STATUS: Record<ErrorCodeValue, number> = {
  invalid_auth: 400,
  invalid_content_length: 400,
  invalid_cursor: 400,
  invalid_idempotency_key: 400,
  invalid_request: 400,
  file_count_cap_exceeded: 400,
  file_size_cap_exceeded: 400,
  revision_size_cap_exceeded: 400,
  not_authenticated: 401,
  forbidden: 403,
  not_found: 404,
  artifact_not_found: 404,
  revision_unpublished: 404,
  api_key_not_found: 404,
  upload_session_not_found: 404,
  api_key_revoked: 409,
  draft_revision_conflict: 409,
  idempotency_in_flight: 409,
  pinned_artifact_cap_exceeded: 409,
  unexpected_upload_object: 409,
  upload_incomplete: 409,
  upload_session_expired: 409,
  entrypoint_not_in_revision: 422,
  revision_retained: 410,
  rate_limited_actor: 429,
  rate_limited_artifact: 429,
  rate_limited_workspace: 429,
  usage_policy_exceeded: 429,
  write_allowance_exceeded: 429,
  revision_ceiling_exceeded: 429,
  ephemeral_provision_rate_limited: 429,
  ephemeral_provision_unavailable: 503,
  pow_required: 401,
  pow_invalid: 400,
  database_unavailable: 503,
  storage_unavailable: 503,
};

export const APP_ERROR_STATUS = {
  ...ERROR_STATUS,
  internal_error: 500,
  not_supported: 501,
} as const;
export type AppErrorCode = keyof typeof APP_ERROR_STATUS;

export type ErrorResponseOptions = {
  message?: string | undefined;
  headers?: Record<string, string> | undefined;
  docsBaseUrl?: string | undefined;
  defaultHeaders?: Record<string, string> | undefined;
};

export function jsonResponse(
  context: Context,
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      [REQUEST_ID_HEADER]: getRequestId(context),
      ...extraHeaders,
    },
  });
}

export function errorResponse(context: Context, code: AppErrorCode, options: ErrorResponseOptions = {}): Response {
  const requestId = getRequestId(context);
  const body = buildErrorBody({
    code,
    ...(options.message !== undefined ? { message: options.message } : {}),
    requestId,
    docsBaseUrl: options.docsBaseUrl,
  });
  return new Response(JSON.stringify(body), {
    status: APP_ERROR_STATUS[code],
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      ...(options.defaultHeaders ?? {}),
      ...(options.headers ?? {}),
      [REQUEST_ID_HEADER]: requestId,
    },
  });
}

// Ergonomic error response for app workers: reads DOCS_BASE_URL off the worker
// env so callers do not repeat the wiring. Workers re-export this directly.
export function appErrorResponse<E extends Env & { Bindings: { DOCS_BASE_URL?: string } }>(
  context: Context<E>,
  code: AppErrorCode,
  message?: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return errorResponse(context, code, {
    message,
    headers: extraHeaders,
    docsBaseUrl: context.env.DOCS_BASE_URL,
  });
}

export function unknownErrorToCode(error: unknown): ErrorCodeValue | null {
  if (!(error instanceof Error)) {
    return null;
  }
  return ErrorCode.options.includes(error.message as ErrorCodeValue) ? (error.message as ErrorCodeValue) : null;
}
