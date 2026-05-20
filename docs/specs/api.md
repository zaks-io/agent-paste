# API Contract

The canonical code registry is [`packages/contracts/src/routes.ts`](../../packages/contracts/src/routes.ts). This document explains the route contract in implementation terms.

## Hosts

| Surface | Host | Owns |
|---|---|---|
| `api` | `https://api.agent-paste.sh` | Auth, workspace state, publishing, Agent View, Access Links, API Keys, audit, usage policy. |
| `upload` | `https://upload.agent-paste.sh` | Upload Sessions, signed PUT URLs, finalize verification. |
| `content` | `https://usercontent.agent-paste.sh` | Signed-token content and bundle reads. |
| `web` | `https://app.agent-paste.sh` | Dashboard, `/al/{publicId}` viewer, operator UI. |
| `mcp` | `https://mcp.agent-paste.sh` | OAuth-only MCP transport. |

Preview hosts use the same path contracts with preview-specific hostnames and secrets.

## Headers

| Header | Direction | Required | Notes |
|---|---|---|---|
| `Authorization: Bearer ...` | request | Authenticated routes | Auth0 access token or API Key bearer depending on surface. |
| `Idempotency-Key` | request | Durable mutations | Required where the route registry says `required`. |
| `X-Request-Id` | request/response | Optional request, always response | Server generates one when omitted. |
| `Retry-After` | response | 429 and long pending states | Seconds. |

The CLI never accepts secrets as flags. API Key auth comes from `AGENT_PASTE_API_KEY`; interactive auth comes from the CLI credential store.

## Auth Labels

| Label | Meaning |
|---|---|
| `none` | No caller authentication. Only Access Link resolve and content-token reads use this. |
| `any_authenticated` | Auth0 dashboard bearer, CLI bearer, MCP-forwarded bearer, or API Key, subject to route scopes. |
| `member_dashboard` | Auth0 dashboard audience only; API Keys, CLI, and MCP are rejected. |
| `operator` | Web admin route, Cloudflare Access in production, Auth0 session, and `OPERATOR_EMAILS` allowlist. |

## API Routes

| Method | Path | Auth | Scopes | Idempotency | Request | Response |
|---|---|---|---|---|---|---|
| `GET` | `/v1/whoami` | any authenticated | any | none | - | `WhoamiResponse` |
| `GET` | `/v1/usage-policy` | any authenticated | any | none | - | `UsagePolicy` |
| `GET` | `/v1/artifacts` | any authenticated | `read` | none | `PaginationRequest` | `ArtifactListResponse` |
| `GET` | `/v1/artifacts/{artifact_id}` | any authenticated | `read` | none | - | `ArtifactDetail` |
| `POST` | `/v1/artifacts/{artifact_id}/publish` | any authenticated | `write read share` | required | `PublishRequest` | `PublishResult` |
| `GET` | `/v1/artifacts/{artifact_id}/agent-view` | any authenticated | `read` | none | - | `AgentView` |
| `PATCH` | `/v1/artifacts/{artifact_id}/display-metadata` | any authenticated | `write` | required | `UpdateDisplayMetadataRequest` | `UpdateDisplayMetadataResponse` |
| `DELETE` | `/v1/artifacts/{artifact_id}` | any authenticated | `write` | required | `DeleteArtifactRequest` | `DeleteArtifactResponse` |
| `GET` | `/v1/artifacts/{artifact_id}/revisions` | any authenticated | `read` | none | `PaginationRequest` | `RevisionListResponse` |
| `GET` | `/v1/artifacts/{artifact_id}/revisions/{revision_id}/agent-view` | any authenticated | `read` | none | - | `AgentView` |
| `DELETE` | `/v1/artifacts/{artifact_id}/drafts/{revision_id}` | any authenticated | `write` | required | - | `DiscardDraftRevisionResponse` |
| `GET` | `/v1/artifacts/{artifact_id}/access-link-lockdown` | any authenticated | `read share` | none | - | `AccessLinkLockdownResponse` |
| `POST` | `/v1/artifacts/{artifact_id}/access-link-lockdown` | any authenticated | `share` | required | - | `AccessLinkLockdownResponse` |
| `DELETE` | `/v1/artifacts/{artifact_id}/access-link-lockdown` | any authenticated | `share` | required | - | `AccessLinkLockdownResponse` |
| `POST` | `/v1/artifacts/{artifact_id}/pin` | dashboard member | `manage_workspace` | required | - | `PinArtifactResponse` |
| `DELETE` | `/v1/artifacts/{artifact_id}/pin` | dashboard member | `manage_workspace` | required | - | `PinArtifactResponse` |
| `POST` | `/v1/artifacts/{artifact_id}/access-links` | any authenticated | `read share` | required | `CreateAccessLinkRequest` | `CreateAccessLinkResponse` |
| `GET` | `/v1/artifacts/{artifact_id}/access-links` | any authenticated | `read share` | none | `PaginationRequest` | `AccessLinkListResponse` |
| `POST` | `/v1/access-links/{access_link_id}/mint` | any authenticated | `read share` | none | - | `MintAccessLinkResponse` |
| `DELETE` | `/v1/access-links/{access_link_id}` | any authenticated | `share` | required | - | `RevokeAccessLinkResponse` |
| `POST` | `/v1/access-links/resolve` | none | none | none | `ResolveAccessLinkRequest` | `ResolveAccessLinkResponse` |
| `GET` | `/v1/api-keys` | dashboard member | `manage_keys` | none | `PaginationRequest` | `ApiKeyListResponse` |
| `POST` | `/v1/api-keys` | dashboard member | `manage_keys` | required | `CreateApiKeyRequest` | `CreateApiKeyResponse` |
| `DELETE` | `/v1/api-keys/{api_key_id}` | dashboard member | `manage_keys` | required | - | `RevokeApiKeyResponse` |
| `GET` | `/v1/audit-events` | dashboard member | `read_audit` | none | `PaginationRequest` | `AuditEventListResponse` |
| `PATCH` | `/v1/workspace` | dashboard member | `manage_workspace` | required | `UpdateWorkspaceRequest` | `UpdateWorkspaceResponse` |

`/v1/access-links/resolve` always maps invalid signature, expired URL, revoked row, lockdown, retained revision, deleted artifact, and wrong workspace to `404 { code: "not_found" }`.

## Upload Routes

| Method | Path | Auth | Scopes | Idempotency | Request | Response |
|---|---|---|---|---|---|---|
| `POST` | `/v1/upload-sessions` | any authenticated | `write` | required | `CreateUploadSessionRequest` | `CreateUploadSessionResponse` |
| `POST` | `/v1/upload-sessions/{session_id}/files/refresh-url` | any authenticated | `write` | none | `RefreshUploadUrlRequest` | `RefreshUploadUrlResponse` |
| `POST` | `/v1/upload-sessions/{session_id}/finalize` | any authenticated | `write` | required | - | `FinalizeUploadSessionResponse` |
| `DELETE` | `/v1/upload-sessions/{session_id}` | any authenticated | `write` | required | - | `AbandonUploadSessionResponse` |

Create reserves `artifact_id` and `revision_id`, but does not create `artifacts` or `revisions` rows. Finalize creates the durable Unpublished Artifact when needed and creates a `draft` Revision.

## Content Routes

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/v/{token}/{path}` | signed content token | File bytes or renderer page. |
| `GET` | `/v/{token}/_render/{mode}?path={path}` | signed content token | Platform renderer for Markdown, text, and directory modes. |
| `GET` | `/b/{token}` | signed content token | Bundle bytes. |

Content authorization failures are generic `not_found`. Artifact Rate Limit failures return `429 rate_limited_artifact` with `Retry-After`. The content Worker never reads Postgres and never exposes R2 URLs.

## Operator Routes

Operator routes are served by `api` under `/admin/*`, reached through the `web` admin surface, and are not part of `/v1`.

| Method | Path | Auth | Idempotency | Request | Response |
|---|---|---|---|---|---|
| `POST` | `/admin/platform-lockdowns` | operator | required | `PlatformLockdownRequest` | `PlatformLockdownResponse` |

Implementation may add a lift endpoint beside this route when the operator UI is built; it must remain operator-only and API-Key-inaccessible.

## Publish Flow

1. CLI/API client calls `POST upload /v1/upload-sessions`.
2. Client PUTs files to returned signed R2 URLs.
3. Client calls `POST upload /v1/upload-sessions/{session_id}/finalize`.
4. Client calls `POST api /v1/artifacts/{artifact_id}/publish`.
5. `api` creates the required Revision Link, optional Share Link, signs content URLs, enqueues bundle generation and safety scan, and returns `PublishResult`.

One user-visible publish uses one idempotency key threaded through the three durable operations with operation names from `runCommand`.
