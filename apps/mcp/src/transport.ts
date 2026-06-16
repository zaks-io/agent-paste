import {
  MCP_RESOURCE_INDICATOR,
  type McpAuthChallengeError,
  mapMcpProtocolError,
  mcpWwwAuthenticateHeader,
} from "@agent-paste/contracts";
import {
  createUnconfiguredMcpBearerAuth,
  createWorkOsMcpBearerAuth,
  type McpAuthContext,
  type VerifyMcpBearer,
} from "./auth.js";
import type { ApiServiceBinding, UploadServiceBinding } from "./forward.js";
import { jsonRpcErrorResponse, mapParseFailure, parseMcpJsonRpcBody, respondWithJsonRpc } from "./jsonrpc.js";
import { handleMcpProtocolMethod } from "./protocol.js";
import { traceMcpRequest } from "./sentry-mcp.js";
import type { McpWorkOsEnv } from "./workos.js";

export type McpTransportEnv = McpWorkOsEnv & {
  MCP_RESOURCE?: string;
  API?: ApiServiceBinding;
  UPLOAD?: UploadServiceBinding;
};

export type McpTransportDeps = {
  verifyBearer?: VerifyMcpBearer;
  api?: ApiServiceBinding;
  upload?: UploadServiceBinding;
};

function resourceFromEnv(env: McpTransportEnv): string {
  return env.MCP_RESOURCE ?? MCP_RESOURCE_INDICATOR;
}

function unauthorizedMcpResponse(message: string, resource: string): Response {
  return jsonRpcErrorResponse(undefined, mapMcpProtocolError("invalid_token", message), {
    headers: authenticateChallengeHeaders(resource, "invalid_token"),
  });
}

function authenticateChallengeHeaders(resource: string, error: McpAuthChallengeError): Headers {
  return new Headers({
    "www-authenticate": mcpWwwAuthenticateHeader(resource, error),
  });
}

/** RFC 6750: auth failures carry a WWW-Authenticate challenge whose error= matches the failure. */
function challengeHeadersForError(code: string, resource: string): Headers | undefined {
  if (code === "invalid_token" || code === "insufficient_scope") {
    return authenticateChallengeHeaders(resource, code);
  }
  return undefined;
}

type McpParsedBody = ReturnType<typeof parseMcpJsonRpcBody>;
type McpParsedRequest = Extract<McpParsedBody, { kind: "request" }>;

export async function handleMcpEndpoint(
  request: Request,
  env: McpTransportEnv,
  deps: McpTransportDeps = {},
): Promise<Response> {
  const resource = resourceFromEnv(env);

  if (request.method !== "POST") {
    return new Response(null, { status: 405 });
  }

  const verifyBearer = deps.verifyBearer ?? bearerVerifierForEnv(env);
  const authResult = await verifyBearer({ authorizationHeader: request.headers.get("authorization") });
  if (!authResult.ok) {
    return unauthorizedMcpResponse(authResult.message, resource);
  }

  const bodyResult = await readJsonRpcBody(request);
  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const parsed = parseMcpJsonRpcBody(bodyResult.body);
  const earlyResponse = respondToNonRequest(parsed);
  if (earlyResponse) {
    return earlyResponse;
  }

  return dispatchMcpRequest(request, parsed as McpParsedRequest, authResult.context, deps, env, resource);
}

async function readJsonRpcBody(
  request: Request,
): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return {
      ok: false,
      response: jsonRpcErrorResponse(undefined, mapMcpProtocolError("invalid_params", "content_type_must_be_json")),
    };
  }
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return {
      ok: false,
      response: jsonRpcErrorResponse(undefined, mapMcpProtocolError("invalid_params", "invalid_json")),
    };
  }
}

/** Resolve non-request JSON-RPC payloads (invalid bodies, notifications, responses) to an early Response. */
function respondToNonRequest(parsed: McpParsedBody): Response | null {
  if (parsed.kind === "invalid") {
    return jsonRpcErrorResponse(undefined, mapParseFailure(parsed.message));
  }
  if (parsed.kind === "notification") {
    // MCP receivers accept and ignore unknown notifications; there is no id to respond to.
    return new Response(null, { status: 202 });
  }
  if (parsed.kind === "response") {
    return new Response(null, { status: 202 });
  }
  return null;
}

async function dispatchMcpRequest(
  request: Request,
  parsed: McpParsedRequest,
  auth: McpAuthContext,
  deps: McpTransportDeps,
  env: McpTransportEnv,
  resource: string,
): Promise<Response> {
  const requestId = parsed.request.id;
  if (requestId === undefined || requestId === null) {
    return jsonRpcErrorResponse(undefined, mapMcpProtocolError("invalid_params", "json_rpc_request_id_required"));
  }

  const handled = await traceMcpRequest(
    {
      method: parsed.request.method,
      params: parsed.request.params,
      id: requestId,
      sessionId: optionalSessionId(request),
    },
    async () => handleMcpProtocolMethod(buildProtocolInput(parsed, requestId, auth, deps, env)),
  );

  if (handled.kind === "accepted") {
    return new Response(null, { status: 202 });
  }
  if (handled.kind === "error") {
    const challenge = challengeHeadersForError(handled.error.code, resource);
    return jsonRpcErrorResponse(requestId, handled.error, challenge ? { headers: challenge } : undefined);
  }
  return respondWithJsonRpc(handled.response, request.headers.get("accept"), optionalSessionHeader(request));
}

function buildProtocolInput(
  parsed: McpParsedRequest,
  requestId: NonNullable<McpParsedRequest["request"]["id"]>,
  auth: McpAuthContext,
  deps: McpTransportDeps,
  env: McpTransportEnv,
): Parameters<typeof handleMcpProtocolMethod>[0] {
  const protocolInput: Parameters<typeof handleMcpProtocolMethod>[0] = {
    method: parsed.request.method,
    params: parsed.request.params,
    id: requestId,
    auth,
  };
  const apiBinding = deps.api ?? env.API;
  const uploadBinding = deps.upload ?? env.UPLOAD;
  if (apiBinding && uploadBinding) {
    protocolInput.toolDeps = {
      api: apiBinding,
      upload: uploadBinding,
      bearerToken: auth.bearerToken,
      jsonRpcId: requestId,
    };
  }
  return protocolInput;
}

function bearerVerifierForEnv(env: McpTransportEnv): VerifyMcpBearer {
  const { API: _api, ...workOsEnv } = env;
  if (env.WORKOS_API_KEY && (env.WORKOS_MCP_JWKS_URL ?? env.WORKOS_CLI_JWKS_URL)) {
    return createWorkOsMcpBearerAuth(workOsEnv);
  }
  return createUnconfiguredMcpBearerAuth();
}

function optionalSessionHeader(request: Request): HeadersInit | undefined {
  const sessionId = optionalSessionId(request);
  if (!sessionId) {
    return undefined;
  }
  return { "mcp-session-id": sessionId };
}

function optionalSessionId(request: Request): string | null {
  return request.headers.get("mcp-session-id");
}
