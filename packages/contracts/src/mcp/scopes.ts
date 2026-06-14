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

export type McpAuthChallengeError = "invalid_token" | "insufficient_scope";

export function mcpWwwAuthenticateHeader(
  resource: string = MCP_RESOURCE_INDICATOR,
  error: McpAuthChallengeError = "invalid_token",
): string {
  const resourceMetadata = `${trimTrailingSlashes(resource)}/.well-known/oauth-protected-resource`;
  return `Bearer realm="mcp.agent-paste.sh", error="${error}", resource_metadata="${resourceMetadata}"`;
}

export function mcpTokenHasRequiredScopes(
  granted: readonly McpScopeValue[],
  required: readonly McpScopeValue[],
): boolean {
  const grantedSet = new Set(granted);
  return required.every((scope) => grantedSet.has(scope));
}

// There is ONE scope vocabulary shared by the API and MCP: `read` (look at your
// stuff), `publish` (change your stuff — create/revise/delete, and manage public
// access to it: make_public, list and revoke its links), and `admin`
// (account/workspace management — API keys, settings, audit, billing). MCP tools
// declare and check `requiredScopes` directly in these names, and a member's
// granted set is their stored API scopes verbatim (ADR 0079). No translation
// layer, so nothing to keep in sync.
