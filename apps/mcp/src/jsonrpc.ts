import type { McpJsonRpcError, McpJsonRpcId, McpJsonRpcRequest, McpMappedToolError } from "@agent-paste/contracts";
import {
  MCP_JSONRPC_VERSION,
  McpJsonRpcRequest as McpJsonRpcRequestSchema,
  mapMcpProtocolError,
  toMcpJsonRpcError,
} from "@agent-paste/contracts";

export const MCP_PROTOCOL_VERSION = "2025-06-18";

export type JsonRpcNotification = {
  jsonrpc: typeof MCP_JSONRPC_VERSION;
  method: string;
  params?: Record<string, unknown>;
};

export type JsonRpcResponse = {
  jsonrpc: typeof MCP_JSONRPC_VERSION;
  id: McpJsonRpcId;
  result?: unknown;
  error?: McpJsonRpcError;
};

export type ParsedMcpJsonRpc =
  | { kind: "request"; request: McpJsonRpcRequest }
  | { kind: "notification"; notification: JsonRpcNotification }
  | { kind: "response"; response: JsonRpcResponse }
  | { kind: "invalid"; message: string };

export function parseMcpJsonRpcBody(body: unknown): ParsedMcpJsonRpc {
  if (!body || typeof body !== "object") {
    return { kind: "invalid", message: "invalid_json_rpc" };
  }
  const record = body as Record<string, unknown>;
  if (record.jsonrpc !== MCP_JSONRPC_VERSION) {
    return { kind: "invalid", message: "invalid_json_rpc_version" };
  }
  if (typeof record.method !== "string" || record.method.length === 0) {
    if ("id" in record && record.id !== undefined) {
      return { kind: "response", response: body as JsonRpcResponse };
    }
    return { kind: "invalid", message: "invalid_json_rpc" };
  }
  const parsedRequest = McpJsonRpcRequestSchema.safeParse(body);
  if (parsedRequest.success && parsedRequest.data.id !== undefined) {
    return { kind: "request", request: parsedRequest.data };
  }
  if ("id" in record && record.id !== undefined) {
    return { kind: "invalid", message: "invalid_json_rpc" };
  }
  return {
    kind: "notification",
    notification: {
      jsonrpc: MCP_JSONRPC_VERSION,
      method: record.method,
      ...(record.params !== undefined ? { params: record.params as Record<string, unknown> } : {}),
    },
  };
}

export function jsonRpcResult(id: McpJsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: MCP_JSONRPC_VERSION, id, result };
}

export function jsonRpcErrorResponse(
  id: McpJsonRpcId | undefined,
  error: McpMappedToolError,
  options?: { headers?: HeadersInit },
): Response {
  const payload =
    id === undefined
      ? {
          jsonrpc: MCP_JSONRPC_VERSION,
          error: toMcpJsonRpcError(error),
        }
      : {
          jsonrpc: MCP_JSONRPC_VERSION,
          id,
          error: toMcpJsonRpcError(error),
        };
  const headers = new Headers(options?.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(payload), {
    status: error.httpStatus,
    headers,
  });
}

export function mapParseFailure(message: string): McpMappedToolError {
  return mapMcpProtocolError("invalid_params", message);
}

export function wantsEventStreamResponse(acceptHeader: string | null): boolean {
  if (!acceptHeader) {
    return false;
  }
  const parts = acceptHeader.split(",").map((part) => part.trim().toLowerCase());
  return parts.some((part) => part.startsWith("text/event-stream"));
}

export function sseMessageFromJsonRpc(message: JsonRpcResponse): string {
  return `event: message\ndata: ${JSON.stringify(message)}\n\n`;
}

export async function sseResponseFromJsonRpc(message: JsonRpcResponse, extraHeaders?: HeadersInit): Promise<Response> {
  const headers = new Headers(extraHeaders);
  headers.set("content-type", "text/event-stream; charset=utf-8");
  headers.set("cache-control", "no-cache, no-transform");
  headers.set("connection", "keep-alive");
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(sseMessageFromJsonRpc(message)));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers });
}

export async function respondWithJsonRpc(
  message: JsonRpcResponse,
  acceptHeader: string | null,
  extraHeaders?: HeadersInit,
): Promise<Response> {
  if (wantsEventStreamResponse(acceptHeader)) {
    return sseResponseFromJsonRpc(message, extraHeaders);
  }
  const headers = new Headers(extraHeaders);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(message), { status: 200, headers });
}
