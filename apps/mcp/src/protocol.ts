import { buildMcpToolList, McpToolCallParams, mapMcpProtocolError } from "@agent-paste/contracts";
import type { McpAuthContext } from "./auth.js";
import { type JsonRpcResponse, jsonRpcResult, MCP_PROTOCOL_VERSION } from "./jsonrpc.js";
import { callMcpTool, type McpToolDeps } from "./tools.js";

export type ProtocolHandlerResult =
  | { kind: "result"; response: JsonRpcResponse }
  | { kind: "accepted" }
  | { kind: "error"; error: ReturnType<typeof mapMcpProtocolError> };

// Free-text lifecycle primer the host injects into the model's context at connect
// (InitializeResult.instructions, MCP 2025-06-18). It teaches the publish → revise →
// live-update rule once, so an agent doesn't republish on an edit and strand the
// user's open link. Keep it consistent with the publish_artifact/add_revision tool
// descriptions in @agent-paste/contracts.
const MCP_LIFECYCLE_INSTRUCTIONS =
  "agent-paste stores work as Artifacts you publish and hand to users as a private_url (a login-walled browser " +
  "link). publish_artifact and add_revision are content-only and PRIVATE — there is no share param. " +
  "Lifecycle: publish_artifact creates a NEW Artifact with a NEW private_url. To change anything you already " +
  "published — fix, update, extend — call add_revision with that Artifact's id; do NOT publish again. The " +
  "private_url is stable and live-updates any page the user already has open to the newest Revision, " +
  "so a revision needs no new link. Publishing again for an edit makes a separate Artifact on a different link " +
  "and strands the user's open page. Publish responses intentionally omit artifact_id; recover it with list_artifacts " +
  "(data[].id). Once you have artifact_id, use read_artifact, read_file, or list_revisions for follow-up work. " +
  "Artifacts are private by default; to make one reachable without login, " +
  "call set_visibility with visibility: 'unlisted', which returns unlisted_url. To remove no-login access, " +
  "call set_visibility with visibility: 'private'.";

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
          instructions: MCP_LIFECYCLE_INSTRUCTIONS,
        }),
      };
    case "notifications/initialized":
      return { kind: "accepted" };
    case "ping":
      return { kind: "result", response: jsonRpcResult(input.id, {}) };
    case "tools/list":
      return {
        kind: "result",
        response: jsonRpcResult(input.id, buildMcpToolList()),
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
      error: mapMcpProtocolError("internal_error", "mcp_service_bindings_not_configured"),
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
