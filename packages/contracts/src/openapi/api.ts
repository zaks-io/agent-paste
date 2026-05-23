import { OpenAPIRegistry, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import { CleanupRunRequest, CreateWorkspaceRequest } from "../admin.js";
import { CreateApiKeyRequest } from "../apiKeys.js";
import { z } from "../zod.js";
import { schemaRef, standardJsonResponses } from "./responses.js";
import { idempotencyKeyHeader, registerApiSchemas, requestIdHeader, securitySchemes } from "./shared.js";

const pathStringParam = (name: string, description: string) =>
  z.string().openapi({
    param: { name, in: "path", required: true, description },
  });

export type ApiOpenApiOptions = {
  serverUrl?: string | undefined;
  docsBaseUrl?: string | undefined;
};

export function buildApiOpenApiDocument(options: ApiOpenApiOptions = {}): Record<string, unknown> {
  const registry = new OpenAPIRegistry();
  registerApiSchemas(registry);

  for (const [name, scheme] of Object.entries(securitySchemes)) {
    registry.registerComponent("securitySchemes", name, scheme);
  }

  const params = (paramSchemas: Record<string, ReturnType<typeof pathStringParam>>) => z.object(paramSchemas);

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
    path: "/v1/usage-policy",
    operationId: "usagePolicy.get",
    summary: "Read the MVP usage policy.",
    security: [{ ApiKeyBearer: [] }],
    request: { headers: [requestIdHeader] },
    responses: standardJsonResponses(schemaRef("UsagePolicy")),
  });

  registry.registerPath({
    method: "get",
    path: "/v1/public/agent-view/{token}",
    operationId: "agentView.public",
    summary: "Resolve a signed public Agent View.",
    request: {
      params: params({ token: pathStringParam("token", "Signed Agent View token.") }),
      headers: [requestIdHeader],
    },
    responses: standardJsonResponses(schemaRef("AgentView"), 200, { authenticated: false }),
  });

  registry.registerPath({
    method: "post",
    path: "/v1/auth/web/callback",
    operationId: "web.auth.callback",
    summary: "Resolve or provision a Workspace Member from a WorkOS AuthKit session.",
    security: [{ WorkOsBearer: [] }],
    request: { headers: [requestIdHeader] },
    responses: standardJsonResponses(schemaRef("WebAuthCallbackResponse")),
  });

  registry.registerPath({
    method: "get",
    path: "/v1/web/workspace",
    operationId: "web.workspace.get",
    summary: "Read the current web Workspace context.",
    security: [{ WorkOsBearer: [] }],
    request: { headers: [requestIdHeader] },
    responses: standardJsonResponses(schemaRef("WebWorkspaceResponse")),
  });

  registry.registerPath({
    method: "get",
    path: "/v1/web/artifacts",
    operationId: "web.artifacts.list",
    summary: "List artifacts for the current Workspace Member.",
    security: [{ WorkOsBearer: [] }],
    request: { headers: [requestIdHeader] },
    responses: standardJsonResponses(schemaRef("WebArtifactListResponse")),
  });

  registry.registerPath({
    method: "get",
    path: "/v1/web/artifacts/{artifact_id}",
    operationId: "web.artifacts.get",
    summary: "Read an artifact for the current Workspace Member.",
    security: [{ WorkOsBearer: [] }],
    request: {
      params: params({ artifact_id: pathStringParam("artifact_id", "Artifact id.") }),
      headers: [requestIdHeader],
    },
    responses: standardJsonResponses(schemaRef("WebArtifactDetailResponse")),
  });

  registry.registerPath({
    method: "get",
    path: "/v1/web/keys",
    operationId: "web.apiKeys.list",
    summary: "List API keys for the current Workspace Member.",
    security: [{ WorkOsBearer: [] }],
    request: { headers: [requestIdHeader] },
    responses: standardJsonResponses(schemaRef("WebApiKeyListResponse")),
  });

  registry.registerPath({
    method: "get",
    path: "/v1/web/audit",
    operationId: "web.audit.list",
    summary: "List Audit Events for the current Workspace Member.",
    security: [{ WorkOsBearer: [] }],
    request: { headers: [requestIdHeader] },
    responses: standardJsonResponses(schemaRef("WebAuditListResponse")),
  });

  registry.registerPath({
    method: "get",
    path: "/v1/web/settings",
    operationId: "web.settings.get",
    summary: "Read web Workspace settings.",
    security: [{ WorkOsBearer: [] }],
    request: { headers: [requestIdHeader] },
    responses: standardJsonResponses(schemaRef("WebSettingsResponse")),
  });

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
    path: "/admin/workspaces",
    operationId: "admin.workspaces.list",
    summary: "List workspaces.",
    security: [{ AdminBearer: [] }],
    request: { headers: [requestIdHeader] },
    responses: standardJsonResponses(schemaRef("WorkspaceListResponse")),
  });

  registry.registerPath({
    method: "post",
    path: "/admin/workspaces",
    operationId: "admin.workspaces.create",
    summary: "Create a workspace.",
    security: [{ AdminBearer: [] }],
    request: {
      headers: [idempotencyKeyHeader, requestIdHeader],
      body: { required: true, content: { "application/json": { schema: CreateWorkspaceRequest } } },
    },
    responses: standardJsonResponses(schemaRef("WorkspaceDetail"), 201),
  });

  registry.registerPath({
    method: "post",
    path: "/admin/workspaces/{workspace_id}/api-keys",
    operationId: "admin.apiKeys.create",
    summary: "Create an API key for a workspace.",
    security: [{ AdminBearer: [] }],
    request: {
      params: params({ workspace_id: pathStringParam("workspace_id", "Workspace id.") }),
      headers: [idempotencyKeyHeader, requestIdHeader],
      body: { required: true, content: { "application/json": { schema: CreateApiKeyRequest } } },
    },
    responses: standardJsonResponses(schemaRef("CreateApiKeyResponse"), 201),
  });

  registry.registerPath({
    method: "delete",
    path: "/admin/api-keys/{api_key_id}",
    operationId: "admin.apiKeys.revoke",
    summary: "Revoke an API key.",
    security: [{ AdminBearer: [] }],
    request: {
      params: params({ api_key_id: pathStringParam("api_key_id", "API key id.") }),
      headers: [idempotencyKeyHeader, requestIdHeader],
    },
    responses: standardJsonResponses(schemaRef("RevokeApiKeyResponse")),
  });

  registry.registerPath({
    method: "get",
    path: "/admin/artifacts",
    operationId: "admin.artifacts.list",
    summary: "List artifacts across workspaces.",
    security: [{ AdminBearer: [] }],
    request: { headers: [requestIdHeader] },
    responses: standardJsonResponses(schemaRef("ArtifactListResponse")),
  });

  registry.registerPath({
    method: "get",
    path: "/admin/artifacts/{artifact_id}",
    operationId: "admin.artifacts.get",
    summary: "Read an artifact detail.",
    security: [{ AdminBearer: [] }],
    request: {
      params: params({ artifact_id: pathStringParam("artifact_id", "Artifact id.") }),
      headers: [requestIdHeader],
    },
    responses: standardJsonResponses(schemaRef("ArtifactDetail")),
  });

  registry.registerPath({
    method: "delete",
    path: "/admin/artifacts/{artifact_id}",
    operationId: "admin.artifacts.delete",
    summary: "Delete an artifact and purge its bytes.",
    security: [{ AdminBearer: [] }],
    request: {
      params: params({ artifact_id: pathStringParam("artifact_id", "Artifact id.") }),
      headers: [idempotencyKeyHeader, requestIdHeader],
    },
    responses: standardJsonResponses(schemaRef("DeleteArtifactResponse")),
  });

  registry.registerPath({
    method: "post",
    path: "/admin/cleanup/run",
    operationId: "admin.cleanup.run",
    summary: "Run a cleanup pass over expired artifacts and sessions.",
    security: [{ AdminBearer: [] }],
    request: {
      headers: [idempotencyKeyHeader, requestIdHeader],
      body: { required: true, content: { "application/json": { schema: CleanupRunRequest } } },
    },
    responses: standardJsonResponses(schemaRef("CleanupRunResponse")),
  });

  registry.registerPath({
    method: "get",
    path: "/admin/operation-events",
    operationId: "admin.operationEvents.list",
    summary: "List recent operation events.",
    security: [{ AdminBearer: [] }],
    request: { headers: [requestIdHeader] },
    responses: standardJsonResponses(schemaRef("OperationEventListResponse")),
  });

  const generator = new OpenApiGeneratorV31(registry.definitions);
  const document = generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "Agent Paste API",
      version: "0.1.0",
      description: "Workspace-scoped JSON API for publishing and reading Agent View artifacts.",
    },
    servers: [{ url: options.serverUrl ?? "https://api.agent-paste.sh" }],
    ...(options.docsBaseUrl ? { externalDocs: { url: options.docsBaseUrl } } : {}),
  });
  return document as unknown as Record<string, unknown>;
}
