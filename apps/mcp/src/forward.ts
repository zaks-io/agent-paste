import type { ErrorCode, RouteId } from "@agent-paste/contracts";
import {
  type McpMappedToolError,
  mapApiErrorToMcp,
  mapMcpProtocolError,
  routeContractById,
} from "@agent-paste/contracts";

export type ServiceBinding = {
  fetch(request: Request): Promise<Response>;
};

export type ApiServiceBinding = ServiceBinding;
export type UploadServiceBinding = ServiceBinding;

export type ForwardToApiInput = {
  api: ApiServiceBinding;
  method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT" | "HEAD";
  path: string;
  bearerToken: string;
  headers?: HeadersInit;
  body?: string;
  idempotencyKey?: string;
};

export type RoutePathParams = Record<string, string>;
export type RouteQueryParams = Record<string, string | number | boolean | null | undefined>;

export type ForwardToApiRouteInput = Omit<ForwardToApiInput, "method" | "path"> & {
  routeId: RouteId;
  params?: RoutePathParams;
  query?: RouteQueryParams;
};

export type ForwardToApiSuccess = {
  ok: true;
  status: number;
  body: unknown;
};

export type ForwardToApiFailure = {
  ok: false;
  error: McpMappedToolError;
};

export type ForwardToApiResult = ForwardToApiSuccess | ForwardToApiFailure;

export async function forwardToApiRoute(input: ForwardToApiRouteInput): Promise<ForwardToApiResult> {
  const { routeId, params, query, ...forward } = input;
  const route = routeContractById(routeId);
  if (route.app !== "api") {
    return { ok: false, error: mapMcpProtocolError("internal_error", "internal_error") };
  }
  return forwardToApi({
    ...forward,
    method: route.method,
    path: buildRoutePath(route.path, params, query),
  });
}

type ForwardToBindingInput = Omit<ForwardToApiInput, "api"> & {
  binding: ServiceBinding;
};

async function forwardToBinding(input: ForwardToBindingInput): Promise<ForwardToApiResult> {
  const headers = new Headers(input.headers);
  headers.set("authorization", `Bearer ${input.bearerToken}`);
  if (input.idempotencyKey) {
    headers.set("idempotency-key", input.idempotencyKey);
  }
  if (input.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  let response: Response;
  try {
    response = await input.binding.fetch(
      new Request(`https://agent-paste.internal${input.path}`, {
        method: input.method,
        headers,
        ...(input.body !== undefined ? { body: input.body } : {}),
      }),
    );
  } catch {
    return {
      ok: false,
      error: mapApiErrorToMcp({ code: "database_unavailable", message: "database_unavailable" }),
    };
  }

  return mapForwardResponse(response);
}

export async function forwardToApi(input: ForwardToApiInput): Promise<ForwardToApiResult> {
  const { api, ...forward } = input;
  return forwardToBinding({ ...forward, binding: api });
}

export type ForwardToUploadInput = Omit<ForwardToApiInput, "api"> & { upload: UploadServiceBinding };

export type ForwardToUploadRouteInput = Omit<ForwardToUploadInput, "method" | "path"> & {
  routeId: RouteId;
  params?: RoutePathParams;
  query?: RouteQueryParams;
};

export async function forwardToUploadRoute(input: ForwardToUploadRouteInput): Promise<ForwardToApiResult> {
  const { routeId, params, query, ...forward } = input;
  const route = routeContractById(routeId);
  if (route.app !== "upload") {
    return { ok: false, error: mapMcpProtocolError("internal_error", "internal_error") };
  }
  return forwardToUpload({
    ...forward,
    method: route.method,
    path: buildRoutePath(route.path, params, query),
  });
}

export async function forwardToUpload(input: ForwardToUploadInput): Promise<ForwardToApiResult> {
  const { upload, ...forward } = input;
  return forwardToBinding({ ...forward, binding: upload });
}

export function buildRoutePath(template: string, params: RoutePathParams = {}, query: RouteQueryParams = {}): string {
  const path = template.replace(/\{([^}]+)\}/g, (_match, key: string) => {
    const value = params[key];
    if (value === undefined) {
      throw new Error(`Missing route path param: ${key}`);
    }
    return encodeURIComponent(value);
  });
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) {
      search.set(key, String(value));
    }
  }
  const encodedQuery = search.toString();
  return encodedQuery ? `${path}?${encodedQuery}` : path;
}

export async function putSignedUploadFile(input: {
  putUrl: string;
  body: Uint8Array;
  contentType: string;
  requiredHeaders?: Record<string, string>;
}): Promise<ForwardToApiResult> {
  const headers = new Headers(input.requiredHeaders ?? {});
  headers.set("content-type", input.contentType);

  let response: Response;
  try {
    response = await fetch(input.putUrl, {
      method: "PUT",
      headers,
      body: new Blob([Uint8Array.from(input.body)]),
    });
  } catch {
    return {
      ok: false,
      error: mapApiErrorToMcp({ code: "storage_unavailable", message: "storage_unavailable" }),
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      error: mapApiErrorToMcp({ code: "upload_incomplete", message: "upload_incomplete" }),
    };
  }

  return { ok: true, status: response.status, body: null };
}

async function mapForwardResponse(response: Response): Promise<ForwardToApiResult> {
  let body: unknown = null;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      body = await response.json();
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const envelope =
      body && typeof body === "object" && "error" in body
        ? (body as { error: { code?: string; message?: string; request_id?: string; docs?: string } }).error
        : null;
    const code = envelope?.code;
    if (code === "not_authenticated" || code === "invalid_auth") {
      return { ok: false, error: mapMcpProtocolError("invalid_token", "invalid_token") };
    }
    if (code === "forbidden") {
      return { ok: false, error: mapMcpProtocolError("insufficient_scope", "insufficient_scope") };
    }
    if (code && typeof code === "string" && typeof envelope?.message === "string") {
      return {
        ok: false,
        error: mapApiErrorToMcp({
          code: code as ErrorCode,
          message: envelope.message,
          ...(envelope.request_id ? { requestId: envelope.request_id } : {}),
          ...(envelope.docs ? { docs: envelope.docs } : {}),
        }),
      };
    }
    if (response.status === 401) {
      return { ok: false, error: mapMcpProtocolError("invalid_token", "invalid_token") };
    }
    if (response.status === 403) {
      return { ok: false, error: mapMcpProtocolError("insufficient_scope", "insufficient_scope") };
    }
    return {
      ok: false,
      error: mapApiErrorToMcp({ code: "invalid_request", message: "invalid_request" }),
    };
  }

  return { ok: true, status: response.status, body };
}
