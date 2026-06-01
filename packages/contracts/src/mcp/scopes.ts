import type { Scope } from "../enums.js";
import {
  MCP_DELEGATED_SCOPES,
  MCP_EXCLUDED_MEMBER_ONLY_SCOPES,
  MCP_RESOURCE_INDICATOR,
} from "./constants.js";
import { McpProtectedResourceMetadata, McpScope } from "./schemas.js";
import type { McpScope as McpScopeValue } from "./schemas.js";

const mcpScopeSet = new Set<string>(MCP_DELEGATED_SCOPES);
const excludedMemberOnlyScopeSet = new Set<string>(MCP_EXCLUDED_MEMBER_ONLY_SCOPES);

export function mcpProtectedResourceMetadata(
  input: { resource?: string; authorizationServers?: readonly string[] } = {},
): McpProtectedResourceMetadata {
  return McpProtectedResourceMetadata.parse({
    resource: input.resource ?? MCP_RESOURCE_INDICATOR,
    authorization_servers: [...(input.authorizationServers ?? [])],
    bearer_methods_supported: ["header"],
    scopes_supported: [...MCP_DELEGATED_SCOPES],
  });
}

export function mcpWwwAuthenticateHeader(resource = MCP_RESOURCE_INDICATOR): string {
  const resourceMetadata = `${resource}/.well-known/oauth-protected-resource`;
  return `Bearer realm="mcp.agent-paste.sh", error="invalid_token", resource_metadata="${resourceMetadata}"`;
}

export function mcpTokenHasRequiredScopes(granted: readonly McpScopeValue[], required: readonly McpScopeValue[]): boolean {
  const grantedSet = new Set(granted);
  return required.every((scope) => grantedSet.has(scope));
}

/** Parse the OAuth `scope` claim into delegated MCP scopes only. */
export function parseMcpScopeClaim(value: unknown): McpScopeValue[] {
  if (typeof value !== "string" || value.trim().length === 0) {
    return [];
  }
  const scopes: McpScopeValue[] = [];
  for (const part of value.split(/\s+/u)) {
    if (mcpScopeSet.has(part)) {
      scopes.push(McpScope.parse(part));
    }
  }
  return scopes;
}

/** True when the claim includes Member-Only Scopes that MCP tokens must never carry. */
export function mcpScopeClaimIncludesMemberOnlyScopes(value: unknown): boolean {
  if (typeof value !== "string" || value.trim().length === 0) {
    return false;
  }
  return value.split(/\s+/u).some((part) => excludedMemberOnlyScopeSet.has(part));
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
