import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "../zod.js";
import type { ApiPathHelpers } from "./api.helpers.js";
import { schemaRef, standardJsonResponses } from "./responses.js";

/**
 * Artifact, revision, and agent-view API OpenAPI paths, split out of `api.ts` to keep
 * each file under the `noExcessiveLinesPerFile` limit.
 */
export function registerArtifactPaths(registry: OpenAPIRegistry, helpers: ApiPathHelpers): void {
  const { params, pathStringParam, queryStringParam, queryOptionalStringParam, idempotencyKeyHeader, requestIdHeader } =
    helpers;

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
    path: "/v1/artifacts/{artifact_id}/file-content",
    operationId: "artifacts.fileContent",
    summary: "Read one stored file's decrypted plaintext for the owning member.",
    security: [{ ApiKeyBearer: [] }],
    request: {
      params: params({ artifact_id: pathStringParam("artifact_id", "Artifact id.") }),
      query: z.object({
        path: queryStringParam("path", "File path within the artifact tree."),
        revision_id: queryOptionalStringParam("revision_id", "Revision to read; defaults to the latest."),
      }),
      headers: [requestIdHeader],
    },
    responses: standardJsonResponses(schemaRef("ArtifactFileContent")),
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
      body: { required: false, content: { "application/json": { schema: schemaRef("PublishRevisionRequest") } } },
    },
    responses: standardJsonResponses(schemaRef("PublishResult")),
  });
}
