import type { ErrorCode } from "./common.js";
import type { Scope } from "./enums.js";

export type AppSurface = "api" | "upload" | "content" | "admin";
export type HttpMethod = "GET" | "POST" | "DELETE" | "PUT";
export type AuthRequirement =
  | "none"
  | "api_key"
  | "admin_token"
  | "workos_access_token"
  | "signed_agent_view_token"
  | "signed_upload_url"
  | "signed_content_token";
export type IdempotencyRequirement = "none" | "required";

export type RouteContract = {
  id: string;
  app: AppSurface;
  method: HttpMethod;
  path: string;
  auth: AuthRequirement;
  scopes: readonly Scope[];
  idempotency: IdempotencyRequirement;
  requestSchema?: string;
  responseSchema: string;
  errors: readonly ErrorCode[];
};

const apiKeyReadErrors = ["not_authenticated", "invalid_auth", "database_unavailable"] as const;
const apiKeyMutationErrors = [
  ...apiKeyReadErrors,
  "invalid_idempotency_key",
  "idempotency_in_flight",
  "usage_policy_exceeded",
] as const;
const adminReadErrors = ["not_authenticated", "forbidden", "database_unavailable"] as const;
const adminMutationErrors = [
  ...adminReadErrors,
  "invalid_idempotency_key",
  "idempotency_in_flight",
  "invalid_request",
] as const;
const webReadErrors = ["not_authenticated", "forbidden", "database_unavailable"] as const;
const webMutationErrors = [...webReadErrors, "invalid_request"] as const;
const webIdempotentMutationErrors = [...webMutationErrors, "invalid_idempotency_key", "idempotency_in_flight"] as const;
const webCallbackErrors = [...webMutationErrors, "idempotency_in_flight"] as const;

export const routeContracts = [
  {
    id: "whoami.get",
    app: "api",
    method: "GET",
    path: "/v1/whoami",
    auth: "api_key",
    scopes: [],
    idempotency: "none",
    responseSchema: "WhoamiResponse",
    errors: apiKeyReadErrors,
  },
  {
    id: "usagePolicy.get",
    app: "api",
    method: "GET",
    path: "/v1/usage-policy",
    auth: "api_key",
    scopes: [],
    idempotency: "none",
    responseSchema: "UsagePolicy",
    errors: apiKeyReadErrors,
  },
  {
    id: "agentView.public",
    app: "api",
    method: "GET",
    path: "/v1/public/agent-view/{token}",
    auth: "signed_agent_view_token",
    scopes: [],
    idempotency: "none",
    responseSchema: "AgentView",
    errors: ["not_found", "database_unavailable"],
  },
  {
    id: "web.auth.callback",
    app: "api",
    method: "POST",
    path: "/v1/auth/web/callback",
    auth: "workos_access_token",
    scopes: [],
    idempotency: "none",
    responseSchema: "WebAuthCallbackResponse",
    errors: webCallbackErrors,
  },
  {
    id: "web.workspace.get",
    app: "api",
    method: "GET",
    path: "/v1/web/workspace",
    auth: "workos_access_token",
    scopes: [],
    idempotency: "none",
    responseSchema: "WebWorkspaceResponse",
    errors: webReadErrors,
  },
  {
    id: "web.artifacts.list",
    app: "api",
    method: "GET",
    path: "/v1/web/artifacts",
    auth: "workos_access_token",
    scopes: ["read"],
    idempotency: "none",
    responseSchema: "WebArtifactListResponse",
    errors: [...webReadErrors, "invalid_cursor", "invalid_request"],
  },
  {
    id: "web.artifacts.get",
    app: "api",
    method: "GET",
    path: "/v1/web/artifacts/{artifact_id}",
    auth: "workos_access_token",
    scopes: ["read"],
    idempotency: "none",
    responseSchema: "WebArtifactDetailResponse",
    errors: [...webReadErrors, "not_found"],
  },
  {
    id: "web.apiKeys.list",
    app: "api",
    method: "GET",
    path: "/v1/web/keys",
    auth: "workos_access_token",
    scopes: ["admin"],
    idempotency: "none",
    responseSchema: "WebApiKeyListResponse",
    errors: webReadErrors,
  },
  {
    id: "web.apiKeys.create",
    app: "api",
    method: "POST",
    path: "/v1/web/keys",
    auth: "workos_access_token",
    scopes: ["admin"],
    idempotency: "required",
    requestSchema: "CreateApiKeyRequest",
    responseSchema: "CreateApiKeyResponse",
    errors: webIdempotentMutationErrors,
  },
  {
    id: "web.apiKeys.revoke",
    app: "api",
    method: "POST",
    path: "/v1/web/keys/{api_key_id}/revoke",
    auth: "workos_access_token",
    scopes: ["admin"],
    idempotency: "required",
    responseSchema: "RevokeApiKeyResponse",
    errors: [...webIdempotentMutationErrors, "not_found"],
  },
  {
    id: "web.audit.list",
    app: "api",
    method: "GET",
    path: "/v1/web/audit",
    auth: "workos_access_token",
    scopes: ["admin"],
    idempotency: "none",
    responseSchema: "WebAuditListResponse",
    errors: webReadErrors,
  },
  {
    id: "web.settings.get",
    app: "api",
    method: "GET",
    path: "/v1/web/settings",
    auth: "workos_access_token",
    scopes: ["admin"],
    idempotency: "none",
    responseSchema: "WebSettingsResponse",
    errors: webReadErrors,
  },
  {
    id: "uploadSessions.create",
    app: "upload",
    method: "POST",
    path: "/v1/upload-sessions",
    auth: "api_key",
    scopes: ["publish"],
    idempotency: "required",
    requestSchema: "CreateUploadSessionRequest",
    responseSchema: "CreateUploadSessionResponse",
    errors: [
      ...apiKeyMutationErrors,
      "file_count_cap_exceeded",
      "file_size_cap_exceeded",
      "revision_size_cap_exceeded",
    ],
  },
  {
    id: "uploadSessions.putFile",
    app: "upload",
    method: "PUT",
    path: "/v1/upload-sessions/{upload_session_id}/files/{path}",
    auth: "signed_upload_url",
    scopes: [],
    idempotency: "none",
    responseSchema: "EmptyObject",
    errors: [
      "not_found",
      "invalid_content_length",
      "file_size_cap_exceeded",
      "upload_session_expired",
      "upload_session_not_found",
      "unexpected_upload_object",
    ],
  },
  {
    id: "uploadSessions.finalize",
    app: "upload",
    method: "POST",
    path: "/v1/upload-sessions/{upload_session_id}/finalize",
    auth: "api_key",
    scopes: ["publish"],
    idempotency: "required",
    responseSchema: "PublishResult",
    errors: [
      ...apiKeyMutationErrors,
      "entrypoint_not_in_revision",
      "unexpected_upload_object",
      "upload_incomplete",
      "upload_session_expired",
      "upload_session_not_found",
    ],
  },
  {
    id: "content.get",
    app: "content",
    method: "GET",
    path: "/v/{token}/{path}",
    auth: "signed_content_token",
    scopes: [],
    idempotency: "none",
    responseSchema: "Response",
    errors: ["not_found", "rate_limited_artifact"],
  },
  {
    id: "admin.workspaces.create",
    app: "admin",
    method: "POST",
    path: "/admin/workspaces",
    auth: "admin_token",
    scopes: ["admin"],
    idempotency: "required",
    requestSchema: "CreateWorkspaceRequest",
    responseSchema: "WorkspaceDetail",
    errors: adminMutationErrors,
  },
  {
    id: "admin.workspaces.list",
    app: "admin",
    method: "GET",
    path: "/admin/workspaces",
    auth: "admin_token",
    scopes: ["admin"],
    idempotency: "none",
    responseSchema: "WorkspaceListResponse",
    errors: adminReadErrors,
  },
  {
    id: "admin.apiKeys.create",
    app: "admin",
    method: "POST",
    path: "/admin/workspaces/{workspace_id}/api-keys",
    auth: "admin_token",
    scopes: ["admin"],
    idempotency: "required",
    requestSchema: "CreateApiKeyRequest",
    responseSchema: "CreateApiKeyResponse",
    errors: adminMutationErrors,
  },
  {
    id: "admin.apiKeys.revoke",
    app: "admin",
    method: "DELETE",
    path: "/admin/api-keys/{api_key_id}",
    auth: "admin_token",
    scopes: ["admin"],
    idempotency: "required",
    responseSchema: "RevokeApiKeyResponse",
    errors: [...adminMutationErrors, "api_key_not_found", "api_key_revoked"],
  },
  {
    id: "admin.artifacts.list",
    app: "admin",
    method: "GET",
    path: "/admin/artifacts",
    auth: "admin_token",
    scopes: ["admin"],
    idempotency: "none",
    responseSchema: "ArtifactListResponse",
    errors: adminReadErrors,
  },
  {
    id: "admin.artifacts.get",
    app: "admin",
    method: "GET",
    path: "/admin/artifacts/{artifact_id}",
    auth: "admin_token",
    scopes: ["admin"],
    idempotency: "none",
    responseSchema: "ArtifactDetail",
    errors: [...adminReadErrors, "artifact_not_found"],
  },
  {
    id: "admin.artifacts.delete",
    app: "admin",
    method: "DELETE",
    path: "/admin/artifacts/{artifact_id}",
    auth: "admin_token",
    scopes: ["admin"],
    idempotency: "required",
    responseSchema: "DeleteArtifactResponse",
    errors: [...adminMutationErrors, "artifact_not_found"],
  },
  {
    id: "admin.cleanup.run",
    app: "admin",
    method: "POST",
    path: "/admin/cleanup/run",
    auth: "admin_token",
    scopes: ["admin"],
    idempotency: "required",
    requestSchema: "CleanupRunRequest",
    responseSchema: "CleanupRunResponse",
    errors: adminMutationErrors,
  },
  {
    id: "admin.operationEvents.list",
    app: "admin",
    method: "GET",
    path: "/admin/operation-events",
    auth: "admin_token",
    scopes: ["admin"],
    idempotency: "none",
    responseSchema: "OperationEventListResponse",
    errors: adminReadErrors,
  },
] as const satisfies readonly RouteContract[];
