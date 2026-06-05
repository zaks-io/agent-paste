import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { artifactRateLimitResponse, errorResponse, jsonOk, schemaRef } from "./responses.js";
import type { ApiPathHelpers } from "./api.helpers.js";

/**
 * Unauthenticated public OpenAPI paths, split out of `api.ts` to keep
 * each file under the `noExcessiveLinesPerFile` limit.
 */
export function registerPublicPaths(registry: OpenAPIRegistry, helpers: ApiPathHelpers): void {
  const { params, pathStringParam, requestIdHeader } = helpers;

  registry.registerPath({
    method: "get",
    path: "/v1/public/agent-view/{token}",
    operationId: "agentView.public",
    summary: "Resolve a signed public Agent View.",
    request: {
      params: params({ token: pathStringParam("token", "Signed Agent View token.") }),
      headers: [requestIdHeader],
    },
    responses: {
      "200": jsonOk(schemaRef("AgentView"), "Success (200)"),
      "400": errorResponse,
      "404": errorResponse,
      "409": errorResponse,
      "429": artifactRateLimitResponse,
      "500": errorResponse,
      "503": errorResponse,
    },
  });

  registry.registerPath({
    method: "post",
    path: "/v1/access-links/resolve",
    operationId: "accessLinks.resolve",
    summary: "Resolve an Access Link Signed URL to Agent View and content URLs.",
    request: {
      headers: [requestIdHeader],
      body: {
        required: true,
        content: {
          "application/json": {
            schema: schemaRef("AccessLinkResolveRequest"),
          },
        },
      },
    },
    responses: {
      "200": jsonOk(schemaRef("AccessLinkResolveResponse"), "Success (200)"),
      "400": errorResponse,
      "404": errorResponse,
      "429": artifactRateLimitResponse,
      "500": errorResponse,
      "503": errorResponse,
    },
  });

  registry.registerPath({
    method: "get",
    path: "/v1/public/cli-version",
    operationId: "cli.version",
    summary: "Advertise the latest and minimum-supported CLI versions.",
    request: { headers: [requestIdHeader] },
    // The handler is total — it serves a safe default on missing/malformed/
    // erroring KV (contract errors: []), so it only ever returns 200.
    responses: {
      "200": jsonOk(schemaRef("CliVersionResponse"), "Success (200)"),
    },
  });
}
