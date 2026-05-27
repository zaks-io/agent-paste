import { MCP_RESOURCE_INDICATOR, mapMcpProtocolError, mcpWwwAuthenticateHeader } from "@agent-paste/contracts";
import { createUnconfiguredMcpBearerAuth, type VerifyMcpBearer } from "./auth.js";
import { jsonRpcErrorResponse, mapParseFailure, parseMcpJsonRpcBody, respondWithJsonRpc } from "./jsonrpc.js";
import { handleMcpProtocolMethod } from "./protocol.js";

export type McpTransportEnv = {
  MCP_RESOURCE?: string;
};

export type McpTransportDeps = {
  verifyBearer?: VerifyMcpBearer;
};

function resourceFromEnv(env: McpTransportEnv): string {
  return env.MCP_RESOURCE ?? "https://mcp.agent-paste.sh";
}

function unauthorizedMcpResponse(message: string, resource: string): Response {
  return jsonRpcErrorResponse(undefined, mapMcpProtocolError("invalid_token", message), {
    headers: authenticateChallengeHeaders(resource),
  });
}

function authenticateChallengeHeaders(resource: string): Headers {
  const header =
    resource === MCP_RESOURCE_INDICATOR
      ? mcpWwwAuthenticateHeader()
      : `Bearer realm="mcp.agent-paste.sh", error="invalid_token", resource_metadata="${resource}/.well-known/oauth-protected-resource"`;
  return new Headers({
    "www-authenticate": header,
  });
}

export async function handleMcpEndpoint(
  request: Request,
  env: McpTransportEnv,
  deps: McpTransportDeps = {},
): Promise<Response> {
  const resource = resourceFromEnv(env);
  const verifyBearer = deps.verifyBearer ?? createUnconfiguredMcpBearerAuth();

  if (request.method === "GET" || request.method === "DELETE") {
    return new Response(null, { status: 405 });
  }
  if (request.method !== "POST") {
    return new Response(null, { status: 405 });
  }

  const authResult = await verifyBearer({
    authorizationHeader: request.headers.get("authorization"),
  });
  if (!authResult.ok) {
    return unauthorizedMcpResponse(authResult.message, resource);
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return jsonRpcErrorResponse(undefined, mapMcpProtocolError("invalid_params", "content_type_must_be_json"));
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonRpcErrorResponse(undefined, mapMcpProtocolError("invalid_params", "invalid_json"));
  }

  const parsed = parseMcpJsonRpcBody(body);
  if (parsed.kind === "invalid") {
    return jsonRpcErrorResponse(undefined, mapParseFailure(parsed.message));
  }

  if (parsed.kind === "notification") {
    if (parsed.notification.method !== "notifications/initialized") {
      return jsonRpcErrorResponse(undefined, mapMcpProtocolError("method_not_found", "method_not_found"));
    }
    return new Response(null, { status: 202 });
  }
  if (parsed.kind === "response") {
    return new Response(null, { status: 202 });
  }

  const requestId = parsed.request.id;
  if (requestId === undefined) {
    return jsonRpcErrorResponse(undefined, mapMcpProtocolError("invalid_params", "json_rpc_request_id_required"));
  }

  const handled = handleMcpProtocolMethod({
    method: parsed.request.method,
    params: parsed.request.params,
    id: requestId,
    auth: authResult.context,
  });

  if (handled.kind === "accepted") {
    return new Response(null, { status: 202 });
  }
  if (handled.kind === "error") {
    const challenge = handled.error.code === "insufficient_scope" ? authenticateChallengeHeaders(resource) : undefined;
    return jsonRpcErrorResponse(requestId, handled.error, challenge ? { headers: challenge } : undefined);
  }

  return respondWithJsonRpc(handled.response, request.headers.get("accept"), optionalSessionHeader(request));
}

function optionalSessionHeader(request: Request): HeadersInit | undefined {
  const sessionId = request.headers.get("mcp-session-id");
  if (!sessionId) {
    return undefined;
  }
  return { "mcp-session-id": sessionId };
}
