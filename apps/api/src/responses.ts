import { IdempotencyInFlightError } from "@agent-paste/commands";
import {
  type AppErrorCode,
  errorResponse as runtimeErrorResponse,
  jsonResponse as runtimeJsonResponse,
} from "@agent-paste/worker-runtime";
import type { AppContext } from "./env.js";

export class RepositoryRouteError extends Error {
  constructor(
    readonly code: AppErrorCode,
    message?: string,
    options?: ErrorOptions,
  ) {
    super(message ?? code, options);
    this.name = "RepositoryRouteError";
  }
}

export function jsonResponse(
  context: AppContext,
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return runtimeJsonResponse(context, body, status, extraHeaders);
}

export function errorResponse(
  context: AppContext,
  code: AppErrorCode,
  message?: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return runtimeErrorResponse(context, code, {
    message,
    headers: extraHeaders,
    docsBaseUrl: context.env.DOCS_BASE_URL,
  });
}

export async function runIdempotent(
  context: AppContext,
  run: () => Promise<unknown>,
  successStatus = 200,
): Promise<Response> {
  try {
    return jsonResponse(context, await run(), successStatus);
  } catch (error) {
    if (error instanceof IdempotencyInFlightError) {
      return errorResponse(context, "idempotency_in_flight");
    }
    if (error instanceof RepositoryRouteError) {
      return errorResponse(context, error.code, error.message);
    }
    throw error;
  }
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return {};
  }

  let value: unknown;
  try {
    value = await request.json();
  } catch (error) {
    throw new RepositoryRouteError("invalid_request", "malformed JSON body", { cause: error });
  }
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function mapRepositoryError(error: unknown): { code: AppErrorCode; message?: string } | null {
  if (!(error instanceof Error)) {
    return null;
  }
  switch (error.message) {
    case "artifact_not_found":
      return { code: "artifact_not_found" };
    case "revision_unpublished":
      return { code: "revision_unpublished" };
    case "revision_retained":
      return { code: "revision_retained" };
    case "entrypoint_not_in_revision":
      return { code: "entrypoint_not_in_revision" };
    case "draft_revision_conflict":
      return { code: "draft_revision_conflict" };
    case "pinned_artifact_cap_exceeded":
      return { code: "pinned_artifact_cap_exceeded" };
    case "revision_ceiling_exceeded":
      return { code: "revision_ceiling_exceeded" };
    case "write_allowance_exceeded":
      return { code: "write_allowance_exceeded" };
    case "invalid_ttl_seconds":
      return { code: "invalid_request" };
    default:
      return null;
  }
}
