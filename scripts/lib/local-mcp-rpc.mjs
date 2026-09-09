import { timingSafeEqual } from "node:crypto";

export const LOCAL_MCP_RPC_SECRET_HEADER = "x-agent-paste-local-mcp-secret";
export const LOCAL_MCP_RPC_SUBJECT_HEADER = "x-agent-paste-local-mcp-subject";
export const LOCAL_MCP_RPC_ROUTE_HEADER = "x-agent-paste-local-mcp-route";

export function addLocalMcpRpcHeaders(headers, { secret, subject, routeId }) {
  requireValue(secret, "Local MCP RPC secret");
  requireValue(subject, "Local MCP RPC subject");
  requireValue(routeId, "Local MCP RPC route ID");
  headers.set(LOCAL_MCP_RPC_SECRET_HEADER, secret);
  headers.set(LOCAL_MCP_RPC_SUBJECT_HEADER, subject);
  headers.set(LOCAL_MCP_RPC_ROUTE_HEADER, routeId);
}

export function createLocalMcpRpcWorker(worker, handleMcpRequest, secret) {
  requireValue(secret, "Local MCP RPC secret");
  return {
    fetch(request, env) {
      const suppliedSecret = request.headers.get(LOCAL_MCP_RPC_SECRET_HEADER);
      const subject = request.headers.get(LOCAL_MCP_RPC_SUBJECT_HEADER);
      const routeId = request.headers.get(LOCAL_MCP_RPC_ROUTE_HEADER);
      if (!suppliedSecret && !subject && !routeId) {
        return worker.fetch(request, env);
      }
      if (!subject || !routeId || !secretsMatch(suppliedSecret, secret)) {
        return Response.json(
          { error: { code: "not_authenticated", message: "Invalid local MCP service credential" } },
          { status: 401 },
        );
      }
      const headers = new Headers(request.headers);
      headers.delete(LOCAL_MCP_RPC_SECRET_HEADER);
      headers.delete(LOCAL_MCP_RPC_SUBJECT_HEADER);
      headers.delete(LOCAL_MCP_RPC_ROUTE_HEADER);
      return handleMcpRequest(new Request(request, { headers }), env, subject, routeId);
    },
  };
}

function secretsMatch(supplied, expected) {
  if (!supplied) {
    return false;
  }
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  return suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes);
}

function requireValue(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}
