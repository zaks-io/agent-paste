import { AccessLinkResolveRequest } from "./accessLinks.js";
import { CreateApiKeyRequest } from "./apiKeys.js";
import type { ErrorCode } from "./common.js";
import type { Scope } from "./enums.js";
import { SetLockdownRequest } from "./lockdown.js";
import { CreateUploadSessionRequest } from "./uploadSessions.js";
import { UpdateWebSettingsRequest } from "./web.js";
import type { z } from "./zod.js";

export type AppSurface = "api" | "upload" | "content";
export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE" | "PUT" | "HEAD";
export type AuthRequirement =
  | "none"
  | "api_key"
  | "workos_access_token"
  | "operator"
  | "signed_agent_view_token"
  | "signed_upload_url"
  | "signed_content_token";
export type IdempotencyRequirement = "none" | "required";
export type RateLimitRequirement = "none" | "actor" | "artifact";

export const requestSchemas = {
  AccessLinkResolveRequest,
  CreateApiKeyRequest,
  CreateUploadSessionRequest,
  SetLockdownRequest,
  UpdateWebSettingsRequest,
} as const;
export type RequestSchemaName = keyof typeof requestSchemas;

export type RouteContract = {
  id: string;
  app: AppSurface;
  method: HttpMethod;
  path: string;
  auth: AuthRequirement;
  scopes: readonly Scope[];
  idempotency: IdempotencyRequirement;
  rateLimit: RateLimitRequirement;
  allowUnprovisioned?: boolean;
  requestSchema?: RequestSchemaName;
  responseSchema: string;
  errors: readonly ErrorCode[];
};

export type RequestBodyFor<Contract extends RouteContract> = Contract extends { requestSchema: infer Name }
  ? Name extends RequestSchemaName
    ? z.infer<(typeof requestSchemas)[Name]>
    : never
  : undefined;

export function requestSchemaFor(contract: Pick<RouteContract, "requestSchema">) {
  return contract.requestSchema ? requestSchemas[contract.requestSchema] : undefined;
}

const apiKeyReadErrors = ["not_authenticated", "invalid_auth", "database_unavailable"] as const;
const apiKeyMutationErrors = [
  ...apiKeyReadErrors,
  "invalid_idempotency_key",
  "idempotency_in_flight",
  "usage_policy_exceeded",
] as const;
const webReadErrors = ["not_authenticated", "forbidden", "database_unavailable"] as const;
const webMutationErrors = [...webReadErrors, "invalid_request"] as const;
const webIdempotentMutationErrors = [...webMutationErrors, "invalid_idempotency_key", "idempotency_in_flight"] as const;
const webCallbackErrors = [...webMutationErrors, "idempotency_in_flight"] as const;
// Operator routes never advertise not_authenticated/forbidden: every auth
// failure collapses to a generic not_found so the surface is non-enumerable
// (ADR 0046).
const operatorMutationErrors = [
  "not_found",
  "invalid_request",
  "invalid_idempotency_key",
  "idempotency_in_flight",
  "database_unavailable",
] as const;
// Operator read routes drop the idempotency errors and add the pagination
// errors, but keep the same not_found collapse so the surface stays
// non-enumerable (ADR 0046).
const operatorReadErrors = ["not_found", "invalid_cursor", "invalid_request", "database_unavailable"] as const;

export const routeContracts = [
  {
    id: "whoami.get",
    app: "api",
    method: "GET",
    path: "/v1/whoami",
    auth: "api_key",
    scopes: [],
    idempotency: "none",
    rateLimit: "actor",
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
    rateLimit: "none",
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
    rateLimit: "artifact",
    responseSchema: "AgentView",
    errors: ["not_found", "database_unavailable", "rate_limited_artifact"],
  },
  {
    id: "accessLinks.resolve",
    app: "api",
    method: "POST",
    path: "/v1/access-links/resolve",
    auth: "none",
    scopes: [],
    idempotency: "none",
    rateLimit: "none",
    requestSchema: "AccessLinkResolveRequest",
    responseSchema: "AccessLinkResolveResponse",
    errors: ["not_found", "invalid_request", "database_unavailable", "rate_limited_artifact"],
  },
  {
    id: "agentView.getLatest",
    app: "api",
    method: "GET",
    path: "/v1/artifacts/{artifact_id}/agent-view",
    auth: "api_key",
    scopes: ["read"],
    idempotency: "none",
    rateLimit: "actor",
    responseSchema: "AgentView",
    errors: [...apiKeyReadErrors, "forbidden", "not_found"],
  },
  {
    id: "agentView.getRevision",
    app: "api",
    method: "GET",
    path: "/v1/artifacts/{artifact_id}/revisions/{revision_id}/agent-view",
    auth: "api_key",
    scopes: ["read"],
    idempotency: "none",
    rateLimit: "actor",
    responseSchema: "AgentView",
    errors: [...apiKeyReadErrors, "forbidden", "not_found", "revision_retained"],
  },
  {
    id: "revisions.list",
    app: "api",
    method: "GET",
    path: "/v1/artifacts/{artifact_id}/revisions",
    auth: "api_key",
    scopes: ["read"],
    idempotency: "none",
    rateLimit: "actor",
    responseSchema: "RevisionListResponse",
    errors: [...apiKeyReadErrors, "forbidden", "artifact_not_found"],
  },
  {
    id: "revisions.publish",
    app: "api",
    method: "POST",
    path: "/v1/artifacts/{artifact_id}/revisions/{revision_id}/publish",
    auth: "api_key",
    scopes: ["publish"],
    idempotency: "required",
    rateLimit: "actor",
    responseSchema: "PublishResult",
    errors: [
      ...apiKeyMutationErrors,
      "artifact_not_found",
      "entrypoint_not_in_revision",
      "revision_retained",
      "revision_unpublished",
    ],
  },
  {
    id: "web.auth.callback",
    app: "api",
    method: "POST",
    path: "/v1/auth/web/callback",
    auth: "workos_access_token",
    scopes: [],
    idempotency: "none",
    rateLimit: "none",
    allowUnprovisioned: true,
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
    rateLimit: "actor",
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
    rateLimit: "actor",
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
    rateLimit: "actor",
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
    rateLimit: "actor",
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
    rateLimit: "actor",
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
    rateLimit: "actor",
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
    rateLimit: "actor",
    responseSchema: "WebAuditListResponse",
    errors: [...webReadErrors, "invalid_cursor", "invalid_request"],
  },
  {
    id: "web.settings.get",
    app: "api",
    method: "GET",
    path: "/v1/web/settings",
    auth: "workos_access_token",
    scopes: ["admin"],
    idempotency: "none",
    rateLimit: "actor",
    responseSchema: "WebSettingsResponse",
    errors: webReadErrors,
  },
  {
    id: "web.settings.update",
    app: "api",
    method: "PATCH",
    path: "/v1/web/settings",
    auth: "workos_access_token",
    scopes: ["admin"],
    idempotency: "required",
    rateLimit: "actor",
    requestSchema: "UpdateWebSettingsRequest",
    responseSchema: "WebSettingsResponse",
    errors: webIdempotentMutationErrors,
  },
  {
    id: "web.admin.lockdown.set",
    app: "api",
    method: "POST",
    path: "/v1/web/admin/lockdowns",
    auth: "operator",
    scopes: [],
    idempotency: "required",
    rateLimit: "actor",
    requestSchema: "SetLockdownRequest",
    responseSchema: "LockdownDetail",
    errors: operatorMutationErrors,
  },
  {
    id: "web.admin.lockdown.list",
    app: "api",
    method: "GET",
    path: "/v1/web/admin/lockdowns",
    auth: "operator",
    scopes: [],
    idempotency: "none",
    rateLimit: "actor",
    responseSchema: "LockdownListResponse",
    errors: operatorReadErrors,
  },
  {
    id: "web.admin.lockdown.lift",
    app: "api",
    method: "DELETE",
    path: "/v1/web/admin/lockdowns/{scope}/{target_id}",
    auth: "operator",
    scopes: [],
    idempotency: "required",
    rateLimit: "actor",
    responseSchema: "LockdownDetail",
    errors: operatorMutationErrors,
  },
  {
    id: "web.admin.events.list",
    app: "api",
    method: "GET",
    path: "/v1/web/admin/events",
    auth: "operator",
    scopes: [],
    idempotency: "none",
    rateLimit: "actor",
    responseSchema: "WebOperatorEventListResponse",
    errors: operatorReadErrors,
  },
  {
    id: "uploadSessions.create",
    app: "upload",
    method: "POST",
    path: "/v1/upload-sessions",
    auth: "api_key",
    scopes: ["publish"],
    idempotency: "required",
    rateLimit: "actor",
    requestSchema: "CreateUploadSessionRequest",
    responseSchema: "CreateUploadSessionResponse",
    errors: [
      ...apiKeyMutationErrors,
      "artifact_not_found",
      "draft_revision_conflict",
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
    rateLimit: "none",
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
    rateLimit: "actor",
    responseSchema: "FinalizeUploadSessionResponse",
    errors: [
      ...apiKeyMutationErrors,
      "artifact_not_found",
      "draft_revision_conflict",
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
    rateLimit: "artifact",
    responseSchema: "Response",
    errors: ["not_found", "rate_limited_artifact"],
  },
  {
    id: "content.head",
    app: "content",
    method: "HEAD",
    path: "/v/{token}/{path}",
    auth: "signed_content_token",
    scopes: [],
    idempotency: "none",
    rateLimit: "artifact",
    responseSchema: "Response",
    errors: ["not_found", "rate_limited_artifact"],
  },
] as const satisfies readonly RouteContract[];
