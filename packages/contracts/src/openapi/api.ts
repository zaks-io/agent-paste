import { OpenAPIRegistry, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import { ActorType, OperationEventAction, OperationEventTargetType } from "../enums.js";
import { Cursor, WorkspaceId } from "../primitives.js";
import { WebOperatorEventFocus } from "../web.js";
import { z } from "../zod.js";
import { artifactRateLimitResponse, errorResponse, jsonOk, schemaRef, standardJsonResponses } from "./responses.js";
import { idempotencyKeyHeader, registerApiSchemas, requestIdHeader, securitySchemes } from "./shared.js";

const pathStringParam = (name: string, description: string) =>
  z.string().openapi({
    param: { name, in: "path", required: true, description },
  });

const pathEnumParam = (name: string, values: readonly [string, ...string[]], description: string) =>
  z.enum(values).openapi({
    param: { name, in: "path", required: true, description },
  });

const queryCursorParam = (name: string, description: string) =>
  Cursor.openapi({
    param: { name, in: "query", required: false, description },
  }).optional();

const queryPageSizeParam = (name: string, description: string) =>
  z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .openapi({
      param: { name, in: "query", required: false, description },
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

  const params = (paramSchemas: Record<string, z.ZodTypeAny>) => z.object(paramSchemas);

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
    request: {
      query: z.object({
        cursor: queryCursorParam("cursor", "Opaque pagination cursor returned by the previous page."),
        limit: queryPageSizeParam("limit", "Maximum number of artifacts to return, up to 100. Defaults to 50."),
      }),
      headers: [requestIdHeader],
    },
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
    method: "post",
    path: "/v1/web/keys",
    operationId: "web.apiKeys.create",
    summary: "Create an API key for the current Workspace Member.",
    security: [{ WorkOsBearer: [] }],
    request: {
      headers: [idempotencyKeyHeader, requestIdHeader],
      body: { required: true, content: { "application/json": { schema: schemaRef("CreateApiKeyRequest") } } },
    },
    responses: standardJsonResponses(schemaRef("CreateApiKeyResponse"), 201),
  });

  registry.registerPath({
    method: "post",
    path: "/v1/web/keys/{api_key_id}/revoke",
    operationId: "web.apiKeys.revoke",
    summary: "Revoke an API key for the current Workspace Member.",
    security: [{ WorkOsBearer: [] }],
    request: {
      params: params({ api_key_id: pathStringParam("api_key_id", "API key id.") }),
      headers: [idempotencyKeyHeader, requestIdHeader],
    },
    responses: standardJsonResponses(schemaRef("RevokeApiKeyResponse")),
  });

  registry.registerPath({
    method: "get",
    path: "/v1/web/audit",
    operationId: "web.audit.list",
    summary: "List Audit Events for the current Workspace Member.",
    security: [{ WorkOsBearer: [] }],
    request: {
      query: z.object({
        cursor: queryCursorParam("cursor", "Opaque pagination cursor returned by the previous page."),
        limit: queryPageSizeParam("limit", "Maximum number of Audit Events to return, up to 100. Defaults to 50."),
      }),
      headers: [requestIdHeader],
    },
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
    method: "patch",
    path: "/v1/web/settings",
    operationId: "web.settings.update",
    summary: "Update web Workspace settings.",
    security: [{ WorkOsBearer: [] }],
    request: {
      headers: [idempotencyKeyHeader, requestIdHeader],
      body: { required: true, content: { "application/json": { schema: schemaRef("UpdateWebSettingsRequest") } } },
    },
    responses: standardJsonResponses(schemaRef("WebSettingsResponse")),
  });

  registry.registerPath({
    method: "get",
    path: "/v1/web/admin/lockdowns",
    operationId: "web.admin.lockdown.list",
    summary: "List effective platform lockdowns (operator only).",
    security: [{ WorkOsBearer: [], CfAccessServiceToken: [] }],
    request: {
      query: z.object({
        cursor: queryCursorParam("cursor", "Opaque pagination cursor returned by the previous page."),
        limit: queryPageSizeParam("limit", "Maximum number of lockdowns to return, up to 100. Defaults to 50."),
      }),
      headers: [requestIdHeader],
    },
    responses: standardJsonResponses(schemaRef("LockdownListResponse"), 200, { authenticated: false }),
  });

  registry.registerPath({
    method: "post",
    path: "/v1/web/admin/lockdowns",
    operationId: "web.admin.lockdown.set",
    summary: "Set a platform lockdown on a workspace or artifact (operator only).",
    security: [{ WorkOsBearer: [], CfAccessServiceToken: [] }],
    request: {
      headers: [idempotencyKeyHeader, requestIdHeader],
      body: { required: true, content: { "application/json": { schema: schemaRef("SetLockdownRequest") } } },
    },
    responses: standardJsonResponses(schemaRef("LockdownDetail"), 201, { authenticated: false }),
  });

  registry.registerPath({
    method: "delete",
    path: "/v1/web/admin/lockdowns/{scope}/{target_id}",
    operationId: "web.admin.lockdown.lift",
    summary: "Lift a platform lockdown on a workspace or artifact (operator only).",
    security: [{ WorkOsBearer: [], CfAccessServiceToken: [] }],
    request: {
      params: params({
        scope: pathEnumParam("scope", ["workspace", "artifact"], "Lockdown scope: workspace or artifact."),
        target_id: pathStringParam("target_id", "Locked-down workspace or artifact id."),
      }),
      headers: [idempotencyKeyHeader, requestIdHeader],
    },
    responses: standardJsonResponses(schemaRef("LockdownDetail"), 200, { authenticated: false }),
  });

  registry.registerPath({
    method: "get",
    path: "/v1/web/admin/events",
    operationId: "web.admin.events.list",
    summary: "Browse cross-workspace audit and operation events (operator only).",
    security: [{ WorkOsBearer: [], CfAccessServiceToken: [] }],
    request: {
      query: z.object({
        cursor: queryCursorParam("cursor", "Opaque pagination cursor returned by the previous page."),
        limit: queryPageSizeParam("limit", "Maximum number of events to return, up to 100. Defaults to 50."),
        workspace_id: WorkspaceId.optional().openapi({
          param: {
            name: "workspace_id",
            in: "query",
            required: false,
            description: "Restrict results to one workspace.",
          },
        }),
        actor_type: ActorType.optional().openapi({
          param: {
            name: "actor_type",
            in: "query",
            required: false,
            description: "Filter by actor type (for example platform or member).",
          },
        }),
        action: OperationEventAction.optional().openapi({
          param: {
            name: "action",
            in: "query",
            required: false,
            description: "Filter by exact action verb.",
          },
        }),
        target_type: OperationEventTargetType.optional().openapi({
          param: {
            name: "target_type",
            in: "query",
            required: false,
            description: "Filter by target type.",
          },
        }),
        request_id: z
          .string()
          .min(1)
          .max(128)
          .optional()
          .openapi({
            param: {
              name: "request_id",
              in: "query",
              required: false,
              description: "Filter by request id.",
            },
          }),
        focus: WebOperatorEventFocus.optional().openapi({
          param: {
            name: "focus",
            in: "query",
            required: false,
            description:
              "Preset filter: security (lockdowns, key revocation, destructive admin) or lifecycle (workspace, keys, artifacts, uploads, cleanup). Defaults to all.",
          },
        }),
      }),
      headers: [requestIdHeader],
    },
    responses: standardJsonResponses(schemaRef("WebOperatorEventListResponse"), 200, { authenticated: false }),
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
  applyWebCursorParameterBounds(document as unknown as Record<string, unknown>);
  return document as unknown as Record<string, unknown>;
}

function applyWebCursorParameterBounds(document: Record<string, unknown>) {
  const paths = document.paths;
  if (!isRecord(paths)) {
    return;
  }
  for (const path of ["/v1/web/artifacts", "/v1/web/audit", "/v1/web/admin/lockdowns", "/v1/web/admin/events"]) {
    const webListPath = paths[path];
    if (!isRecord(webListPath)) {
      continue;
    }
    const getOperation = webListPath.get;
    if (!isRecord(getOperation) || !Array.isArray(getOperation.parameters)) {
      continue;
    }

    const cursorParameter = getOperation.parameters.find(
      (parameter): parameter is { schema: Record<string, unknown> } =>
        isRecord(parameter) && parameter.name === "cursor" && parameter.in === "query" && isRecord(parameter.schema),
    );
    if (cursorParameter) {
      cursorParameter.schema.minLength = 1;
      cursorParameter.schema.maxLength = 500;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
