import { OpenAPIRegistry, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import "../zod-openapi.js";
import { UPLOAD_TARGETS_PAGE_MAX } from "@agent-paste/config";
import { Cursor } from "../primitives.js";
import { AppendUploadFilesRequest, CompleteUploadFilesRequest, CreateUploadSessionRequest } from "../uploadSessions.js";
import { z } from "../zod-openapi.js";
import {
  emptyOkResponse,
  errorResponse,
  rateLimitOrQuotaResponse,
  rateLimitResponse,
  schemaRef,
  standardJsonResponses,
} from "./responses.js";
import { idempotencyKeyHeader, registerUploadSchemas, requestIdHeader, securitySchemes } from "./shared.js";

const pathStringParam = (name: string, description: string) =>
  z.string().openapi({
    param: { name, in: "path", required: true, description },
  });

export type UploadOpenApiOptions = {
  serverUrl?: string | undefined;
};

export function buildUploadOpenApiDocument(options: UploadOpenApiOptions = {}): Record<string, unknown> {
  const registry = new OpenAPIRegistry();
  registerUploadSchemas(registry);

  registry.registerComponent("securitySchemes", "ApiKeyBearer", securitySchemes.ApiKeyBearer);
  registry.registerComponent("securitySchemes", "SignedUploadToken", securitySchemes.SignedUploadToken);
  registry.registerComponent("securitySchemes", "McpOAuthBearer", securitySchemes.McpOAuthBearer);

  const params = (paramSchemas: Record<string, ReturnType<typeof pathStringParam>>) => z.object(paramSchemas);
  const uploadTokenQueryParam = z
    .string()
    .min(1)
    .openapi({
      param: {
        name: "token",
        in: "query",
        required: true,
        description: "Signed upload URL token minted by the create-upload-session response.",
      },
    });

  registry.registerPath({
    method: "post",
    path: "/v1/upload-sessions",
    operationId: "uploadSessions.create",
    summary: "Create an upload session and mint signed PUT targets.",
    security: [{ ApiKeyBearer: [] }, { McpOAuthBearer: [] }],
    request: {
      headers: [idempotencyKeyHeader, requestIdHeader],
      body: { required: true, content: { "application/json": { schema: CreateUploadSessionRequest } } },
    },
    responses: { ...standardJsonResponses(schemaRef("CreateUploadSessionResponse")), "429": rateLimitOrQuotaResponse },
  });

  registry.registerPath({
    method: "put",
    path: "/v1/upload-sessions/{upload_session_id}/files/{path}",
    operationId: "uploadSessions.putFile",
    summary: "Upload a single file using a signed URL.",
    security: [{ SignedUploadToken: [] }],
    request: {
      params: params({
        upload_session_id: pathStringParam("upload_session_id", "Upload session id."),
        path: pathStringParam("path", "File path within the artifact."),
      }),
      query: z.object({ token: uploadTokenQueryParam }),
      headers: [requestIdHeader],
    },
    responses: {
      "204": emptyOkResponse,
      "400": errorResponse,
      "401": errorResponse,
      "404": errorResponse,
      "409": errorResponse,
      "429": rateLimitResponse,
      "503": errorResponse,
    },
  });

  registry.registerPath({
    method: "post",
    path: "/v1/upload-sessions/{upload_session_id}/finalize",
    operationId: "uploadSessions.finalize",
    summary: "Finalize an upload session and create a draft revision.",
    security: [{ ApiKeyBearer: [] }, { McpOAuthBearer: [] }],
    request: {
      params: params({
        upload_session_id: pathStringParam("upload_session_id", "Upload session id."),
      }),
      headers: [idempotencyKeyHeader, requestIdHeader],
    },
    responses: {
      ...standardJsonResponses(schemaRef("FinalizeUploadSessionResponse")),
      "429": rateLimitOrQuotaResponse,
    },
  });

  registerGuardedSessionPaths(registry);

  const document = new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: "3.1.0",
    info: {
      title: "Agent Paste Upload API",
      version: "0.1.0",
      description: "Signed-URL upload session lifecycle for Agent Paste artifacts.",
    },
    servers: [{ url: options.serverUrl ?? "https://upload.agent-paste.sh" }],
    security: [{ ApiKeyBearer: [] }, { SignedUploadToken: [] }],
  });
  return document as unknown as Record<string, unknown>;
}

function registerGuardedSessionPaths(registry: OpenAPIRegistry): void {
  const sessionParams = z.object({ upload_session_id: pathStringParam("upload_session_id", "Upload session id.") });
  for (const [operation, suffix, schema, response] of [
    ["appendFiles", "file-batches", AppendUploadFilesRequest, "AppendUploadFilesResponse"],
    ["completeFiles", "file-completions", CompleteUploadFilesRequest, "CompleteUploadFilesResponse"],
  ] as const)
    registry.registerPath({
      method: "post",
      path: `/v1/upload-sessions/{upload_session_id}/${suffix}`,
      operationId: `uploadSessions.${operation}`,
      summary:
        operation === "appendFiles"
          ? "Append and optionally seal a guarded session batch."
          : "Verify chunked whole-file digests.",
      security: [{ ApiKeyBearer: [] }, { McpOAuthBearer: [] }],
      request: {
        params: sessionParams,
        headers: [idempotencyKeyHeader, requestIdHeader],
        body: { required: true, content: { "application/json": { schema } } },
      },
      responses: {
        ...standardJsonResponses(schemaRef(response)),
        "422": errorResponse,
        "429": rateLimitOrQuotaResponse,
      },
    });
  registry.registerPath({
    method: "get",
    path: "/v1/upload-sessions/{upload_session_id}/targets",
    operationId: "uploadSessions.targets",
    summary: "Page fresh upload targets for resume.",
    security: [{ ApiKeyBearer: [] }, { McpOAuthBearer: [] }],
    request: {
      params: sessionParams,
      headers: [requestIdHeader],
      query: z.object({
        cursor: Cursor.optional(),
        limit: z.number().int().min(1).max(UPLOAD_TARGETS_PAGE_MAX).optional(),
      }),
    },
    responses: standardJsonResponses(schemaRef("UploadSessionTargetsResponse")),
  });
}
