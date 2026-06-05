import { OpenAPIRegistry, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import { ActorType, OperationEventAction, OperationEventTargetType } from "../enums.js";
import { Cursor, WorkspaceId } from "../primitives.js";
import { WebOperatorEventFocus } from "../web.js";
import { z } from "../zod.js";
import { registerBillingPaths } from "./api.billing.js";
import { artifactRateLimitResponse, errorResponse, jsonOk, schemaRef, standardJsonResponses } from "./responses.js";
import { idempotencyKeyHeader, registerApiSchemas, requestIdHeader, securitySchemes } from "./shared.js";
import { applyWebCursorParameterBounds } from "./web-cursor-bounds.js";

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

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: registry-population builder (448 lines), mostly flat schema registration — see docs/ops/complexity-todo.md
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

  registry.registerPath({
    method: "post",
    path: "/v1/ephemeral/provision",
    operationId: "ephemeral.provision",
    summary:
      "Provision an Ephemeral Workspace behind proof-of-work. Send an empty body or `{}` to receive a signed challenge.",
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
      "401": jsonOk(
        schemaRef("EphemeralPowRequiredResponse"),
        "Proof-of-work required; response includes a signed challenge to solve and resubmit.",
      ),
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
    method: "post",
    path: "/v1/web/artifacts/{artifact_id}/pin",
    operationId: "web.artifacts.pin",
    summary: "Pin an artifact to exempt it from auto deletion.",
    security: [{ WorkOsBearer: [] }],
    request: {
      params: params({ artifact_id: pathStringParam("artifact_id", "Artifact id.") }),
      headers: [requestIdHeader, idempotencyKeyHeader],
    },
    responses: standardJsonResponses(schemaRef("WebArtifactDetailResponse")),
  });

  registry.registerPath({
    method: "post",
    path: "/v1/web/artifacts/{artifact_id}/unpin",
    operationId: "web.artifacts.unpin",
    summary: "Unpin an artifact so auto deletion applies again.",
    security: [{ WorkOsBearer: [] }],
    request: {
      params: params({ artifact_id: pathStringParam("artifact_id", "Artifact id.") }),
      headers: [requestIdHeader, idempotencyKeyHeader],
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
    path: "/v1/web/access-links",
    operationId: "web.accessLinks.listAll",
    summary: "List all Access Links across the current Workspace.",
    security: [{ WorkOsBearer: [] }],
    request: { headers: [requestIdHeader] },
    responses: standardJsonResponses(schemaRef("WebAccessLinkListResponse")),
  });

  registry.registerPath({
    method: "get",
    path: "/v1/web/artifacts/{artifact_id}/access-links",
    operationId: "web.accessLinks.listForArtifact",
    summary: "List Access Links for an artifact in the current Workspace.",
    security: [{ WorkOsBearer: [] }],
    request: {
      params: params({ artifact_id: pathStringParam("artifact_id", "Artifact id.") }),
      headers: [requestIdHeader],
    },
    responses: standardJsonResponses(schemaRef("WebAccessLinkListResponse")),
  });

  registry.registerPath({
    method: "get",
    path: "/v1/web/artifacts/{artifact_id}/revisions",
    operationId: "web.revisions.list",
    summary: "List Revisions for an artifact in the current Workspace.",
    security: [{ WorkOsBearer: [] }],
    request: {
      params: params({ artifact_id: pathStringParam("artifact_id", "Artifact id.") }),
      headers: [requestIdHeader],
    },
    responses: standardJsonResponses(schemaRef("RevisionListResponse")),
  });

  registry.registerPath({
    method: "post",
    path: "/v1/web/artifacts/{artifact_id}/access-links",
    operationId: "web.accessLinks.create",
    summary: "Create a Share or Revision Access Link for an artifact.",
    security: [{ WorkOsBearer: [] }],
    request: {
      params: params({ artifact_id: pathStringParam("artifact_id", "Artifact id.") }),
      headers: [idempotencyKeyHeader, requestIdHeader],
      body: { required: true, content: { "application/json": { schema: schemaRef("CreateAccessLinkRequest") } } },
    },
    responses: standardJsonResponses(schemaRef("CreateAccessLinkResponse"), 201),
  });

  registry.registerPath({
    method: "post",
    path: "/v1/web/access-links/{access_link_id}/mint",
    operationId: "web.accessLinks.mint",
    summary: "Mint a fresh Access Link Signed URL for an Access Link.",
    security: [{ WorkOsBearer: [] }],
    request: {
      params: params({ access_link_id: pathStringParam("access_link_id", "Access Link id.") }),
      headers: [requestIdHeader],
    },
    responses: standardJsonResponses(schemaRef("AccessLinkSignedUrl")),
  });

  registry.registerPath({
    method: "post",
    path: "/v1/web/access-links/{access_link_id}/revoke",
    operationId: "web.accessLinks.revoke",
    summary: "Revoke an Access Link in the current Workspace.",
    security: [{ WorkOsBearer: [] }],
    request: {
      params: params({ access_link_id: pathStringParam("access_link_id", "Access Link id.") }),
      headers: [requestIdHeader],
    },
    responses: standardJsonResponses(schemaRef("WebRevokeAccessLinkResponse")),
  });

  registry.registerPath({
    method: "post",
    path: "/v1/web/artifacts/{artifact_id}/access-link-lockdown",
    operationId: "web.accessLinks.lockdown.set",
    summary: "Engage Access Link Lockdown for an artifact.",
    security: [{ WorkOsBearer: [] }],
    request: {
      params: params({ artifact_id: pathStringParam("artifact_id", "Artifact id.") }),
      headers: [idempotencyKeyHeader, requestIdHeader],
    },
    responses: standardJsonResponses(schemaRef("WebArtifactDetailResponse")),
  });

  registry.registerPath({
    method: "post",
    path: "/v1/web/artifacts/{artifact_id}/access-link-lockdown/lift",
    operationId: "web.accessLinks.lockdown.lift",
    summary: "Lift Access Link Lockdown for an artifact.",
    security: [{ WorkOsBearer: [] }],
    request: {
      params: params({ artifact_id: pathStringParam("artifact_id", "Artifact id.") }),
      headers: [idempotencyKeyHeader, requestIdHeader],
    },
    responses: standardJsonResponses(schemaRef("WebArtifactDetailResponse")),
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

  registerBillingPaths(registry, { params, pathStringParam, idempotencyKeyHeader, requestIdHeader });

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
