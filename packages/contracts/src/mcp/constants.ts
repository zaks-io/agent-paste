/** OAuth resource indicator for MCP-issued tokens (ADR 0061). */
export const MCP_RESOURCE_INDICATOR = "https://mcp.agent-paste.sh" as const;

/** The MCP capability vocabulary; a member's granted subset is derived in `api` from their role (ADR 0079). */
export const MCP_DELEGATED_SCOPES = ["write", "read", "share"] as const;

/**
 * OAuth scopes advertised in Protected Resource Metadata. These are the scopes
 * AuthKit actually supports — NOT the capability vocabulary. The MCP client SDK
 * reads `scopes_supported` from PRM and sends them at /authorize; advertising
 * anything outside AuthKit's fixed set (or omitting the field, which makes the
 * SDK fall back to the client's default `mcp:tools`) makes AuthKit reject the
 * request with `invalid_scope`. Member capability is still derived in `api`
 * (ADR 0079); these only get the OAuth handshake through AuthKit.
 */
export const MCP_AUTHKIT_OAUTH_SCOPES = ["openid", "profile", "email", "offline_access"] as const;

export const MCP_REJECTED_AUTH_REQUIREMENTS = ["api_key", "workos_access_token"] as const;

/** Suffix for publish-chain revision-link idempotency records (distinct from share-link). */
export const MCP_PUBLISH_REVISION_LINK_IDEMPOTENCY_SUFFIX = ":revision-link" as const;

/** Suffix for publish-chain share-link idempotency records (distinct from revision-link). */
export const MCP_PUBLISH_SHARE_LINK_IDEMPOTENCY_SUFFIX = ":share-link" as const;

export const MCP_JSONRPC_VERSION = "2.0" as const;
export const MCP_JSONRPC_APPLICATION_ERROR = -32_000;
export const MCP_JSONRPC_INVALID_PARAMS = -32_602;
export const MCP_JSONRPC_METHOD_NOT_FOUND = -32_601;
