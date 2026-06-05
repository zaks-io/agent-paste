/**
 * Unauthenticated public route contracts, split out of `registry.ts` to keep
 * each file under the `noExcessiveLinesPerFile` limit. Spread into `routeContracts`
 * with `as const` so route-id literal inference is preserved.
 */
export const publicRouteContracts = [
  {
    id: "agentView.public",
    app: "api",
    method: "GET",
    path: "/v1/public/agent-view/{token}",
    auth: "signed_agent_view_token",
    scopes: [],
    idempotency: "none",
    rateLimit: "artifact",
    responseSchema: "AgentView",
    errors: ["not_found", "database_unavailable", "rate_limited_artifact"],
  },
  {
    id: "accessLinks.resolve",
    app: "api",
    method: "POST",
    path: "/v1/access-links/resolve",
    auth: "none",
    scopes: [],
    idempotency: "none",
    rateLimit: "none",
    requestSchema: "AccessLinkResolveRequest",
    responseSchema: "AccessLinkResolveResponse",
    errors: ["not_found", "invalid_request", "database_unavailable", "rate_limited_artifact"],
  },
  {
    id: "cli.version",
    app: "api",
    method: "GET",
    path: "/v1/public/cli-version",
    auth: "none",
    scopes: [],
    idempotency: "none",
    rateLimit: "none",
    responseSchema: "CliVersionResponse",
    errors: [],
  },
] as const;
