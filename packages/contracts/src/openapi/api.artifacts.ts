import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { schemaRef, standardJsonResponses } from "./responses.js";
import type { ApiPathHelpers } from "./api.helpers.js";

/**
 * Artifact, revision, and agent-view API OpenAPI paths, split out of `api.ts` to keep
 * each file under the `noExcessiveLinesPerFile` limit.
 */
export function registerArtifactPaths(registry: OpenAPIRegistry, helpers: ApiPathHelpers): void {
  const { params, pathStringParam, idempotencyKeyHeader, requestIdHeader } = helpers;

  registry.registerPath({
    method: "get",
    path: "/v1/artifacts/{artifact_id}/agent-view",
    operationId: "agentView.getLatest",
    summary: "Read the latest Agent View for an artifact.",
    security: [{ ApiKeyBearer: [] }],
    request: {
      params: params({ artifact_id: pathStringParam("artifact_id", "Artifact id.") }),
      headers: [requestIdHeader],
    },
    responses: standardJsonResponses(schemaRef("AgentView")),
  });

  registry.registerPath({
    method: "get",
    path: "/v1/artifacts/{artifact_id}/revisions/{revision_id}/agent-view",
    operationId: "agentView.getRevision",
    summary: "Read the Agent View for a specific revision.",
    security: [{ ApiKeyBearer: [] }],
    request: {
      params: params({
        artifact_id: pathStringParam("artifact_id", "Artifact id."),
        revision_id: pathStringParam("revision_id", "Revision id."),
      }),
      headers: [requestIdHeader],
    },
    responses: standardJsonResponses(schemaRef("AgentView")),
  });

  registry.registerPath({
    method: "get",
    path: "/v1/artifacts/{artifact_id}/revisions",
    operationId: "revisions.list",
    summary: "List revisions for an artifact.",
    security: [{ ApiKeyBearer: [] }],
    request: {
      params: params({ artifact_id: pathStringParam("artifact_id", "Artifact id.") }),
      headers: [requestIdHeader],
    },
    responses: standardJsonResponses(schemaRef("RevisionListResponse")),
  });

  registry.registerPath({
    method: "post",
    path: "/v1/artifacts/{artifact_id}/revisions/{revision_id}/publish",
    operationId: "revisions.publish",
    summary: "Publish a draft revision.",
    security: [{ ApiKeyBearer: [] }],
    request: {
      params: params({
        artifact_id: pathStringParam("artifact_id", "Artifact id."),
        revision_id: pathStringParam("revision_id", "Draft revision id."),
      }),
      headers: [idempotencyKeyHeader, requestIdHeader],
    },
    responses: standardJsonResponses(schemaRef("PublishResult")),
  });
}
