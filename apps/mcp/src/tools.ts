import {
  McpToolCallParams,
  McpWhoamiResponse,
  mapMcpProtocolError,
  mcpTokenHasRequiredScopes,
  mcpToolContractByName,
} from "@agent-paste/contracts";
import type { McpAuthContext } from "./auth.js";
import { type ApiServiceBinding, forwardToApi } from "./forward.js";

export type McpToolDeps = {
  api: ApiServiceBinding;
  bearerToken: string;
};

export type McpToolResult =
  | { ok: true; result: unknown }
  | { ok: false; error: ReturnType<typeof mapMcpProtocolError> };

export async function callMcpTool(
  toolName: string,
  params: Record<string, unknown> | undefined,
  auth: McpAuthContext,
  deps: McpToolDeps,
): Promise<McpToolResult> {
  const parsed = McpToolCallParams.safeParse({ name: toolName, arguments: params });
  if (!parsed.success) {
    return { ok: false, error: mapMcpProtocolError("invalid_params", "invalid_params") };
  }

  const contract = mcpToolContractByName(parsed.data.name);
  if (!mcpTokenHasRequiredScopes(auth.scopes, contract.requiredScopes)) {
    return { ok: false, error: mapMcpProtocolError("insufficient_scope", "insufficient_scope") };
  }

  switch (parsed.data.name) {
    case "whoami":
      return callWhoami(deps);
    default:
      return {
        ok: false,
        error: mapMcpProtocolError("method_not_found", "tools/call is not implemented yet"),
      };
  }
}

async function callWhoami(deps: McpToolDeps): Promise<McpToolResult> {
  const forwarded = await forwardToApi({
    api: deps.api,
    method: "GET",
    path: "/v1/mcp/whoami",
    bearerToken: deps.bearerToken,
  });
  if (!forwarded.ok) {
    return { ok: false, error: forwarded.error };
  }
  const parsed = McpWhoamiResponse.safeParse(forwarded.body);
  if (!parsed.success) {
    return { ok: false, error: mapMcpProtocolError("internal_error", "internal_error") };
  }
  return { ok: true, result: parsed.data };
}
