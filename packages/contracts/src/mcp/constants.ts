/** OAuth resource indicator for MCP-issued tokens (ADR 0061). */
export const MCP_RESOURCE_INDICATOR = "https://mcp.agent-paste.sh" as const;

/** The MCP capability vocabulary; a member's granted subset is derived in `api` from their role (ADR 0079). */
export const MCP_DELEGATED_SCOPES = ["write", "read", "share"] as const;

export const MCP_REJECTED_AUTH_REQUIREMENTS = ["api_key", "workos_access_token"] as const;

/** Suffix for publish-chain revision-link idempotency records (distinct from share-link). */
export const MCP_PUBLISH_REVISION_LINK_IDEMPOTENCY_SUFFIX = ":revision-link" as const;

/** Suffix for publish-chain share-link idempotency records (distinct from revision-link). */
export const MCP_PUBLISH_SHARE_LINK_IDEMPOTENCY_SUFFIX = ":share-link" as const;

export const MCP_JSONRPC_VERSION = "2.0" as const;
export const MCP_JSONRPC_APPLICATION_ERROR = -32_000;
export const MCP_JSONRPC_INVALID_PARAMS = -32_602;
export const MCP_JSONRPC_METHOD_NOT_FOUND = -32_601;
