import { routeErrorGroups } from "./errors.js";

const {
  apiKeyRead: apiKeyReadErrors,
  apiKeyActorRead: apiKeyActorReadErrors,
} = routeErrorGroups;

/**
 * Actor identity and API-key route contracts, split out of `registry.ts` to keep
 * each file under the `noExcessiveLinesPerFile` limit. Spread into `routeContracts`
 * with `as const` so route-id literal inference is preserved.
 */
export const actorRouteContracts = [
  {
    id: "whoami.get",
    app: "api",
    method: "GET",
    path: "/v1/whoami",
    auth: "api_key",
    scopes: [],
    idempotency: "none",
    rateLimit: "actor",
    responseSchema: "WhoamiResponse",
    errors: apiKeyActorReadErrors,
  },
  {
    id: "mcp.whoami",
    app: "api",
    method: "GET",
    path: "/v1/mcp/whoami",
    auth: "mcp_oauth",
    scopes: [],
    idempotency: "none",
    rateLimit: "actor",
    responseSchema: "McpWhoamiResponse",
    errors: [
      "not_authenticated",
      "forbidden",
      "database_unavailable",
      "rate_limited_actor",
      "rate_limited_workspace",
    ] as const,
  },
  {
    id: "usagePolicy.get",
    app: "api",
    method: "GET",
    path: "/v1/usage-policy",
    auth: "api_key",
    scopes: [],
    idempotency: "none",
    rateLimit: "none",
    responseSchema: "UsagePolicy",
    errors: apiKeyReadErrors,
  },
  {
    id: "apiKeys.revokeCurrent",
    app: "api",
    method: "POST",
    path: "/v1/api-keys/current/revoke",
    auth: "api_key",
    scopes: [],
    idempotency: "none",
    rateLimit: "actor",
    responseSchema: "RevokeApiKeyResponse",
    errors: apiKeyActorReadErrors,
  },
] as const;
