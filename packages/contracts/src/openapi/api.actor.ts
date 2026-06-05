import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { schemaRef, standardJsonResponses } from "./responses.js";
import type { ApiPathHelpers } from "./api.helpers.js";

/**
 * Actor identity and usage-policy OpenAPI paths, split out of `api.ts` to keep
 * each file under the `noExcessiveLinesPerFile` limit.
 */
export function registerActorPaths(registry: OpenAPIRegistry, helpers: ApiPathHelpers): void {
  const { requestIdHeader } = helpers;

  registry.registerPath({
    method: "get",
    path: "/v1/whoami",
    operationId: "whoami.get",
    summary: "Resolve the authenticated actor and usage policy.",
    security: [{ ApiKeyBearer: [] }],
    request: { headers: [requestIdHeader] },
    responses: standardJsonResponses(schemaRef("WhoamiResponse")),
  });

  registry.registerPath({
    method: "get",
    path: "/v1/mcp/whoami",
    operationId: "mcp.whoami",
    summary: "Resolve the authenticated workspace member for an MCP OAuth token.",
    security: [{ McpOAuthBearer: [] }],
    request: { headers: [requestIdHeader] },
    responses: standardJsonResponses(schemaRef("McpWhoamiResponse")),
  });

  registry.registerPath({
    method: "get",
    path: "/v1/usage-policy",
    operationId: "usagePolicy.get",
    summary: "Read the MVP usage policy.",
    security: [{ ApiKeyBearer: [] }],
    request: { headers: [requestIdHeader] },
    responses: standardJsonResponses(schemaRef("UsagePolicy")),
  });
}
