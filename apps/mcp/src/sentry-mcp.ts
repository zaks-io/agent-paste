import type { McpJsonRpcId } from "@agent-paste/contracts";
import * as Sentry from "@sentry/cloudflare";
import { MCP_PROTOCOL_VERSION } from "./jsonrpc.js";
import type { ProtocolHandlerResult } from "./protocol.js";

const MCP_SERVER_ATTRIBUTES = {
  "mcp.transport": "streamable_http",
  "mcp.server.name": "agent-paste",
  "mcp.server.title": "Agent Paste MCP",
  "mcp.server.version": "0.1.0",
  "mcp.protocol.version": MCP_PROTOCOL_VERSION,
  "network.protocol.version": "2.0",
} as const;

export async function traceMcpRequest(
  input: {
    method: string;
    id: McpJsonRpcId;
    params: Record<string, unknown> | undefined;
    sessionId: string | null;
  },
  handler: () => ProtocolHandlerResult | Promise<ProtocolHandlerResult>,
): Promise<ProtocolHandlerResult> {
  return await Sentry.startSpan(
    {
      name: `MCP ${input.method}`,
      op: "mcp.server",
      attributes: {
        ...MCP_SERVER_ATTRIBUTES,
        "mcp.method.name": input.method,
        "mcp.request.id": String(input.id),
        "mcp.session.id": input.sessionId ?? undefined,
        "mcp.tool.name": toolNameFrom(input.method, input.params),
      },
    },
    async (span) => {
      const result = await handler();
      if (result.kind === "error") {
        span.setAttributes({
          "mcp.error.code": result.error.code,
          "mcp.tool.result.is_error": input.method === "tools/call" ? true : undefined,
        });
        span.setStatus({ code: 2, message: result.error.code });
      } else {
        span.setAttribute("mcp.tool.result.is_error", input.method === "tools/call" ? false : undefined);
        span.setStatus({ code: 1 });
      }
      return result;
    },
  );
}

function toolNameFrom(method: string, params: Record<string, unknown> | undefined): string | undefined {
  if (method !== "tools/call" || typeof params?.name !== "string") {
    return undefined;
  }
  return params.name;
}
