import type { Context, MiddlewareHandler } from "hono";

export const REQUEST_ID_HEADER = "x-request-id";
export const REQUEST_ID_CONTEXT_KEY = "requestId";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export type DocCode =
  | "rate_limited_actor"
  | "rate_limited_artifact"
  | "rate_limited_workspace"
  | "idempotency_in_flight"
  | "invalid_idempotency_key"
  | "usage_policy_exceeded"
  | "write_allowance_exceeded"
  | "revision_ceiling_exceeded"
  | "file_size_cap_exceeded"
  | "file_count_cap_exceeded"
  | "revision_size_cap_exceeded";

const DOC_PATHS: Record<DocCode, string> = {
  rate_limited_actor: "/errors/rate_limited_actor",
  rate_limited_artifact: "/errors/rate_limited_artifact",
  rate_limited_workspace: "/errors/rate_limited_workspace",
  idempotency_in_flight: "/errors/idempotency_in_flight",
  invalid_idempotency_key: "/errors/invalid_idempotency_key",
  usage_policy_exceeded: "/errors/usage_policy_exceeded",
  write_allowance_exceeded: "/errors/write_allowance_exceeded",
  revision_ceiling_exceeded: "/errors/revision_ceiling_exceeded",
  file_size_cap_exceeded: "/errors/file_size_cap_exceeded",
  file_count_cap_exceeded: "/errors/file_count_cap_exceeded",
  revision_size_cap_exceeded: "/errors/revision_size_cap_exceeded",
};

export function resolveRequestId(request: Request): string {
  const supplied = request.headers.get(REQUEST_ID_HEADER);
  return supplied && REQUEST_ID_PATTERN.test(supplied) ? supplied : crypto.randomUUID();
}

export function docsUrlFor(code: string, baseUrl: string | undefined): string | undefined {
  if (!baseUrl) {
    return undefined;
  }
  const path = DOC_PATHS[code as DocCode];
  if (!path) {
    return undefined;
  }
  return `${trimTrailingSlash(baseUrl)}${path}`;
}

function trimTrailingSlash(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) {
    end -= 1;
  }
  return end === value.length ? value : value.slice(0, end);
}

export type ErrorBody = {
  error: {
    code: string;
    message: string;
    request_id: string;
    docs?: string;
  };
};

export function buildErrorBody(input: {
  code: string;
  message?: string;
  requestId: string;
  docsBaseUrl: string | undefined;
}): ErrorBody {
  const docs = docsUrlFor(input.code, input.docsBaseUrl);
  return {
    error: {
      code: input.code,
      message: input.message ?? input.code,
      request_id: input.requestId,
      ...(docs ? { docs } : {}),
    },
  };
}

export type RequestIdVariables = { [REQUEST_ID_CONTEXT_KEY]: string };

export function requestIdMiddleware(): MiddlewareHandler<{ Variables: RequestIdVariables }> {
  return async (context, next) => {
    const id = resolveRequestId(context.req.raw);
    context.set(REQUEST_ID_CONTEXT_KEY, id);
    await next();
    context.res.headers.set(REQUEST_ID_HEADER, id);
  };
}

export function getRequestId<T extends { Variables: RequestIdVariables }>(context: Context<T>): string {
  return context.get(REQUEST_ID_CONTEXT_KEY);
}
