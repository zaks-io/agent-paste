import { IdempotencyInFlightError } from "@agent-paste/commands";
import type { ErrorCode } from "@agent-paste/contracts";
import { repositoryErrorToAppError } from "@agent-paste/db";
import { type AppErrorCode, getBoundResponders } from "@agent-paste/worker-runtime";
import type { AppContext } from "./env.js";

export type ContractRespondError = (
  code: ErrorCode,
  messageOrOptions?: string | { message?: string; headers?: Record<string, string> },
) => Response;

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

function repositoryErrorResponse(
  context: AppContext,
  code: ErrorCode,
  respondError?: ContractRespondError,
  message?: string,
  headers?: Record<string, string>,
): Response {
  if (respondError) {
    if (message !== undefined) {
      return respondError(code, headers ? { message, headers } : message);
    }
    if (headers !== undefined) {
      return respondError(code, { headers });
    }
    return respondError(code);
  }
  const bound = getBoundResponders(context);
  if (message !== undefined) {
    return bound.respondError(code, headers ? { message, headers } : message);
  }
  if (headers !== undefined) {
    return bound.respondError(code, { headers });
  }
  return bound.respondError(code);
}

export async function runIdempotent(
  context: AppContext,
  run: () => Promise<unknown>,
  options: { successStatus?: number; respondError?: ContractRespondError } = {},
): Promise<Response> {
  const { respondJson, respondError: boundRespondError } = getBoundResponders(context);
  const successStatus = options.successStatus ?? 200;
  try {
    return respondJson(await run(), successStatus);
  } catch (error) {
    if (error instanceof IdempotencyInFlightError) {
      if (options.respondError) {
        return options.respondError("idempotency_in_flight");
      }
      return boundRespondError("idempotency_in_flight");
    }
    if (error instanceof RepositoryRouteError) {
      return repositoryErrorResponse(
        context,
        error.code as ErrorCode,
        options.respondError,
        error.message,
        error.headers,
      );
    }
    const repositoryCode = repositoryErrorToAppError(error);
    if (repositoryCode) {
      return repositoryErrorResponse(context, repositoryCode, options.respondError);
    }
    throw error;
  }
}

export async function executeRepositoryRoute<T>(
  context: AppContext,
  run: () => Promise<T>,
  options: { successStatus?: number; respondError?: ContractRespondError } = {},
): Promise<Response> {
  const { respondJson } = getBoundResponders(context);
  const successStatus = options.successStatus ?? 200;
  try {
    return respondJson(await run(), successStatus);
  } catch (error) {
    const repositoryCode = repositoryErrorToAppError(error);
    if (repositoryCode) {
      return repositoryErrorResponse(context, repositoryCode, options.respondError);
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
