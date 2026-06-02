import { IdempotencyInFlightError } from "@agent-paste/commands";
import { repositoryErrorToAppError } from "@agent-paste/db";
import { type AppErrorCode, appErrorResponse as errorResponse, jsonResponse } from "@agent-paste/worker-runtime";
import type { AppContext } from "./env.js";

export { errorResponse, jsonResponse };

export class RepositoryRouteError extends Error {
  readonly headers: Record<string, string>;

  constructor(
    readonly code: AppErrorCode,
    message?: string,
    options?: ErrorOptions & { headers?: Record<string, string> },
  ) {
    super(message ?? code, options);
    this.name = "RepositoryRouteError";
    this.headers = options?.headers ?? {};
  }
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
      return errorResponse(context, error.code, error.message, error.headers);
    }
    const repositoryCode = repositoryErrorToAppError(error);
    if (repositoryCode) {
      return errorResponse(context, repositoryCode);
    }
    throw error;
  }
}

export async function executeRepositoryRoute<T>(
  context: AppContext,
  run: () => Promise<T>,
  successStatus = 200,
): Promise<Response> {
  try {
    return jsonResponse(context, await run(), successStatus);
  } catch (error) {
    const repositoryCode = repositoryErrorToAppError(error);
    if (repositoryCode) {
      return errorResponse(context, repositoryCode);
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
