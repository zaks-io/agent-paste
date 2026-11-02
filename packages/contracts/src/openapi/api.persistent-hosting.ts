import { FILE_LIST_PAGE_MAX } from "@agent-paste/config";
import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { Cursor, FilePath, RevisionId } from "../primitives.js";
import { z } from "../zod-openapi.js";
import type { ApiPathHelpers } from "./api.helpers.js";
import { errorResponse, schemaRef, standardJsonResponses } from "./responses.js";

export function registerPersistentHostingPaths(registry: OpenAPIRegistry, helpers: ApiPathHelpers): void {
  const { params, pathStringParam, idempotencyKeyHeader, requestIdHeader } = helpers;
  const artifactParams = params({
    artifact_id: pathStringParam("artifact_id", "Artifact ID, bare subdomain, or percent-encoded HTTPS Artifact URL."),
  });
  const security = [{ ApiKeyBearer: [] }, { McpOAuthBearer: [] }];
  for (const action of ["pin", "unpin"] as const)
    registry.registerPath({
      method: "post",
      path: `/v1/artifacts/{artifact_id}/${action}`,
      operationId: `artifacts.${action}`,
      summary: action === "pin" ? "Pin an Artifact." : "Unpin an Artifact and start a fresh retention window.",
      security,
      request: { params: artifactParams, headers: [idempotencyKeyHeader, requestIdHeader] },
      responses: { ...standardJsonResponses(schemaRef("ArtifactRetention")), "403": errorResponse },
    });
  registry.registerPath({
    method: "get",
    path: "/v1/artifacts/{artifact_id}/files",
    operationId: "artifactFiles.list",
    summary: "Page the files of one Revision.",
    security,
    request: {
      params: artifactParams,
      headers: [requestIdHeader],
      query: z.object({
        revision_id: RevisionId.optional(),
        prefix: FilePath.optional(),
        cursor: Cursor.optional(),
        limit: z.number().int().min(1).max(FILE_LIST_PAGE_MAX).optional(),
      }),
    },
    responses: {
      ...standardJsonResponses(schemaRef("ArtifactFileListResponse")),
      "403": errorResponse,
    },
  });
  registry.registerPath({
    method: "get",
    path: "/v1/artifacts/{artifact_id}/read-grant",
    operationId: "artifacts.readGrant",
    summary: "Mint a bounded Revision read grant.",
    security,
    request: {
      params: artifactParams,
      headers: [requestIdHeader],
      query: z.object({ revision_id: RevisionId.optional() }),
    },
    responses: { ...standardJsonResponses(schemaRef("RevisionReadGrant")), "403": errorResponse },
  });
  registry.registerPath({
    method: "get",
    path: "/v1/usage",
    operationId: "usage.get",
    summary: "Read storage usage, reservations, budget and pin allowance.",
    security,
    request: { headers: [requestIdHeader] },
    responses: { ...standardJsonResponses(schemaRef("StorageUsage")), "403": errorResponse },
  });
}
