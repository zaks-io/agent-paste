import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import type { ApiPathHelpers } from "./api.helpers.js";
import { errorResponse, jsonOk, schemaRef, standardJsonResponses } from "./responses.js";

/**
 * Ephemeral workspace OpenAPI paths, split out of `api.ts` to keep
 * each file under the `noExcessiveLinesPerFile` limit.
 */
export function registerEphemeralPaths(registry: OpenAPIRegistry, helpers: ApiPathHelpers): void {
  const { idempotencyKeyHeader, requestIdHeader } = helpers;

  registry.registerPath({
    method: "post",
    path: "/v1/ephemeral/provision",
    operationId: "ephemeral.provision",
    summary: "Provision an Ephemeral Workspace behind rate limits and a short server-side wait.",
    security: [],
    request: {
      headers: [requestIdHeader],
      body: {
        required: false,
        content: {
          "application/json": {
            schema: schemaRef("EphemeralProvisionRequest"),
          },
        },
      },
    },
    responses: {
      "201": jsonOk(schemaRef("EphemeralProvisionResponse"), "Provisioned (201)"),
      "400": errorResponse,
      "429": errorResponse,
      "500": errorResponse,
      "503": errorResponse,
    },
  });

  registry.registerPath({
    method: "post",
    path: "/v1/ephemeral/claim",
    operationId: "ephemeral.claim",
    summary: "Redeem a Claim Token to reparent ephemeral Artifacts into the member's Personal Workspace.",
    security: [{ WorkOsBearer: [] }],
    request: {
      headers: [requestIdHeader, idempotencyKeyHeader],
      body: {
        required: true,
        content: {
          "application/json": {
            schema: schemaRef("EphemeralClaimRequest"),
          },
        },
      },
    },
    responses: standardJsonResponses(schemaRef("EphemeralClaimResponse")),
  });
}
