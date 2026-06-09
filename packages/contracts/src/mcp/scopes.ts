import type { Scope } from "../enums.js";
import { MCP_AUTHKIT_OAUTH_SCOPES, MCP_RESOURCE_INDICATOR } from "./constants.js";
import type { McpScope as McpScopeValue } from "./schemas.js";
import { McpProtectedResourceMetadata } from "./schemas.js";

export function mcpProtectedResourceMetadata(
  input: { resource?: string; resourceName?: string; authorizationServers?: readonly string[] } = {},
): McpProtectedResourceMetadata {
  return McpProtectedResourceMetadata.parse({
    resource: input.resource ?? MCP_RESOURCE_INDICATOR,
    resource_name: input.resourceName ?? "Agent Paste MCP",
    authorization_servers: [...(input.authorizationServers ?? [])],
    bearer_methods_supported: ["header"],
    scopes_supported: [...MCP_AUTHKIT_OAUTH_SCOPES],
  });
}

export function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) {
    end -= 1;
  }
  return end === value.length ? value : value.slice(0, end);
}

export function mcpWwwAuthenticateHeader(resource: string = MCP_RESOURCE_INDICATOR): string {
  const resourceMetadata = `${trimTrailingSlashes(resource)}/.well-known/oauth-protected-resource`;
  return `Bearer realm="mcp.agent-paste.sh", error="invalid_token", resource_metadata="${resourceMetadata}"`;
}

export function mcpTokenHasRequiredScopes(
  granted: readonly McpScopeValue[],
  required: readonly McpScopeValue[],
): boolean {
  const grantedSet = new Set(granted);
  return required.every((scope) => grantedSet.has(scope));
}

/** Map delegated MCP scopes to API route scopes for service-binding forwarding (ADR 0034). */
export function mcpScopesToApiScopes(mcpScopes: readonly McpScopeValue[]): Scope[] {
  const apiScopes: Scope[] = [];
  if (mcpScopes.includes("write")) {
    apiScopes.push("publish");
  }
  if (mcpScopes.includes("read")) {
    apiScopes.push("read");
  }
  if (mcpScopes.includes("share")) {
    apiScopes.push("admin");
  }
  return apiScopes;
}

/** Map a member's API scopes to delegated MCP scopes (inverse of mcpScopesToApiScopes, ADR 0079). */
export function apiScopesToMcpScopes(apiScopes: readonly Scope[]): McpScopeValue[] {
  const mcpScopes: McpScopeValue[] = [];
  if (apiScopes.includes("publish")) {
    mcpScopes.push("write");
  }
  if (apiScopes.includes("read")) {
    mcpScopes.push("read");
  }
  if (apiScopes.includes("admin")) {
    mcpScopes.push("share");
  }
  return mcpScopes;
}
