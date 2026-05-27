import { mapMcpProtocolError } from "@agent-paste/contracts";
import type { McpAuthContext } from "./auth.js";
import { type JsonRpcResponse, jsonRpcResult, MCP_PROTOCOL_VERSION } from "./jsonrpc.js";

export type ProtocolHandlerResult =
  | { kind: "result"; response: JsonRpcResponse }
  | { kind: "accepted" }
  | { kind: "error"; error: ReturnType<typeof mapMcpProtocolError> };

export function handleMcpProtocolMethod(input: {
  method: string;
  params: Record<string, unknown> | undefined;
  id: import("@agent-paste/contracts").McpJsonRpcId;
  auth: McpAuthContext;
}): ProtocolHandlerResult {
  void input.auth;
  switch (input.method) {
    case "initialize":
      return {
        kind: "result",
        response: jsonRpcResult(input.id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {
            tools: { listChanged: false },
          },
          serverInfo: {
            name: "agent-paste",
            version: "0.1.0",
          },
        }),
      };
    case "notifications/initialized":
      return { kind: "accepted" };
    case "ping":
      return { kind: "result", response: jsonRpcResult(input.id, {}) };
    case "tools/list":
      return {
        kind: "result",
        response: jsonRpcResult(input.id, { tools: [] }),
      };
    case "tools/call":
      return {
        kind: "error",
        error: mapMcpProtocolError("method_not_found", "tools/call is not implemented yet"),
      };
    default:
      return {
        kind: "error",
        error: mapMcpProtocolError("method_not_found", "method_not_found"),
      };
  }
}
