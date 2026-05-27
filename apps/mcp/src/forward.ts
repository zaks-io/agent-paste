import type { ErrorCode } from "@agent-paste/contracts";
import { type McpMappedToolError, mapApiErrorToMcp, mapMcpProtocolError } from "@agent-paste/contracts";

export type ApiServiceBinding = {
  fetch(request: Request): Promise<Response>;
};

export type ForwardToApiInput = {
  api: ApiServiceBinding;
  method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
  path: string;
  bearerToken: string;
  headers?: HeadersInit;
  body?: string;
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

export async function forwardToApi(input: ForwardToApiInput): Promise<ForwardToApiResult> {
  const headers = new Headers(input.headers);
  headers.set("authorization", `Bearer ${input.bearerToken}`);
  if (input.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  let response: Response;
  try {
    response = await input.api.fetch(
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
