import { routeContractById } from "../routes.js";
import type { McpForwardedCall, McpResolvedForwardedCall, McpToolContract } from "./types.js";

export function resolveMcpForwardedCall(call: McpForwardedCall): McpResolvedForwardedCall {
  const route = routeContractById(call.routeId);
  return {
    ...call,
    app: route.app,
    method: route.method,
    path: route.path,
    idempotency: route.idempotency,
  };
}

export function resolveMcpForwardedCalls(tool: McpToolContract): McpResolvedForwardedCall[] {
  return tool.forwardedCalls.map(resolveMcpForwardedCall);
}
