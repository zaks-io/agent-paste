import { McpToolCallParams, mapMcpProtocolError } from "@agent-paste/contracts";
import type { McpAuthContext } from "./auth.js";
import { type JsonRpcResponse, jsonRpcResult, MCP_PROTOCOL_VERSION } from "./jsonrpc.js";
import { callMcpTool, type McpToolDeps } from "./tools.js";

export type ProtocolHandlerResult =
  | { kind: "result"; response: JsonRpcResponse }
  | { kind: "accepted" }
  | { kind: "error"; error: ReturnType<typeof mapMcpProtocolError> };

export function handleMcpProtocolMethod(input: {
  method: string;
  params: Record<string, unknown> | undefined;
  id: import("@agent-paste/contracts").McpJsonRpcId;
  auth: McpAuthContext;
  toolDeps?: McpToolDeps;
}): ProtocolHandlerResult | Promise<ProtocolHandlerResult> {
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
      return handleToolsCall(input);
    default:
      return {
        kind: "error",
        error: mapMcpProtocolError("method_not_found", "method_not_found"),
      };
  }
}

async function handleToolsCall(input: {
  params: Record<string, unknown> | undefined;
  id: import("@agent-paste/contracts").McpJsonRpcId;
  auth: McpAuthContext;
  toolDeps?: McpToolDeps;
}): Promise<ProtocolHandlerResult> {
  if (!input.toolDeps) {
    return {
      kind: "error",
      error: mapMcpProtocolError("internal_error", "mcp_api_binding_not_configured"),
    };
  }
  const parsed = McpToolCallParams.safeParse(input.params);
  if (!parsed.success) {
    return { kind: "error", error: mapMcpProtocolError("invalid_params", "invalid_params") };
  }
  const toolResult = await callMcpTool(parsed.data.name, parsed.data.arguments, input.auth, input.toolDeps);
  if (!toolResult.ok) {
    return { kind: "error", error: toolResult.error };
  }
  return {
    kind: "result",
    response: jsonRpcResult(input.id, {
      content: [{ type: "text", text: JSON.stringify(toolResult.result) }],
      structuredContent: toolResult.result,
    }),
  };
}
