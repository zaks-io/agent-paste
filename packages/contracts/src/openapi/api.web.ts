import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "../zod.js";
import type { ApiPathHelpers } from "./api.helpers.js";
import { schemaRef, standardJsonResponses } from "./responses.js";

function registerWebAuthAndWorkspacePaths(registry: OpenAPIRegistry, helpers: ApiPathHelpers): void {
  const { requestIdHeader } = helpers;

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
}

function registerWebArtifactPaths(registry: OpenAPIRegistry, helpers: ApiPathHelpers): void {
  const { params, pathStringParam, queryCursorParam, queryPageSizeParam, idempotencyKeyHeader, requestIdHeader } =
    helpers;

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
}

function registerWebApiKeyPaths(registry: OpenAPIRegistry, helpers: ApiPathHelpers): void {
  const { params, pathStringParam, idempotencyKeyHeader, requestIdHeader } = helpers;

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
}

function registerWebAccessLinkPaths(registry: OpenAPIRegistry, helpers: ApiPathHelpers): void {
  const { params, pathStringParam, idempotencyKeyHeader, requestIdHeader } = helpers;

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
}

function registerWebAuditAndSettingsPaths(registry: OpenAPIRegistry, helpers: ApiPathHelpers): void {
  const { queryCursorParam, queryPageSizeParam, idempotencyKeyHeader, requestIdHeader } = helpers;

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
}

/**
 * Web dashboard OpenAPI paths (non-operator), split out of `api.ts` to keep
 * each file under the `noExcessiveLinesPerFile` limit.
 */
export function registerWebPaths(registry: OpenAPIRegistry, helpers: ApiPathHelpers): void {
  registerWebAuthAndWorkspacePaths(registry, helpers);
  registerWebArtifactPaths(registry, helpers);
  registerWebApiKeyPaths(registry, helpers);
  registerWebAccessLinkPaths(registry, helpers);
  registerWebAuditAndSettingsPaths(registry, helpers);
}
