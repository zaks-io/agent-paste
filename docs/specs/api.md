# API Contract

The canonical code registry is [`packages/contracts/src/routes.ts`](../../packages/contracts/src/routes.ts). This document explains the route contract in implementation terms.

## Hosts

| Surface | Host | Owns |
|---|---|---|
| `api` | `https://api.agent-paste.sh` | Auth, workspace state, publishing, Agent View, Access Links, API Keys, audit, usage policy. |
| `upload` | `https://upload.agent-paste.sh` | Upload Sessions, signed upload-worker PUT URLs, encryption-before-R2, finalize verification. |
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
| `web_auth_callback` | Auth0 web callback completion. `web` has already validated the OAuth transaction cookie, exchanged the authorization code, and calls `api` over a Service Binding with the Auth0 access token plus verified ID-token material. |
| `signed_upload_url` | Short-lived file upload URL minted by `upload`; no bearer token is accepted on the file body PUT itself. |

## Web Auth Callback

`web` owns the browser-facing Auth0 redirect flow and sealed session cookie. `api` owns durable **Workspace** provisioning and default **API Key** creation.

`/login` generates `state`, `nonce`, and a PKCE `code_verifier`, stores them in a short-lived, encrypted, host-only, `HttpOnly`, `Secure`, `SameSite=Lax` transaction cookie, and redirects to Auth0 with:

- `response_type=code`
- exact registered `redirect_uri`
- `scope=openid profile email offline_access`
- `audience=https://api.agent-paste.sh/v1`
- `state`
- `nonce`
- `code_challenge` with `code_challenge_method=S256`

`/auth/callback` rejects missing or mismatched `state`, missing `code`, OAuth error responses, and any callback whose redirect URI does not exactly match the configured callback URL. It exchanges the code server-side with Auth0 using the stored `code_verifier`, validates the returned token set, then calls `POST api /v1/auth/web/callback` over the `web -> api` Service Binding.

The Service Binding request carries `Authorization: Bearer <auth0_access_token>` and body `AuthWebCallbackRequest`:

```json
{
  "id_token": "<jwt>",
  "nonce": "<original nonce>"
}
```

`api` verifies both tokens against Auth0 JWKS, checks issuer, audience, expiration, ID-token nonce, subject equality between tokens, and `email_verified=true`. On first sign-in, `api` runs one `runCommand` transaction to create the **Personal Workspace**, **Workspace Member**, default **Usage Policy**, and one-time default **API Key**. Returning users have email and display name refreshed without creating a new key.

The response is `AuthWebCallbackResponse`: `whoami` plus `first_run_api_key` only when the request created a new default key. The plaintext key must not be logged, persisted, cached, or returned again.

## API Routes

| Method | Path | Auth | Scopes | Idempotency | Request | Response |
|---|---|---|---|---|---|---|
| `POST` | `/v1/auth/web/callback` | web auth callback | none | none | `AuthWebCallbackRequest` | `AuthWebCallbackResponse` |
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
| `PUT` | `/v1/upload-sessions/{session_id}/files/{path}` | signed upload URL | none | none | file bytes | empty |
| `POST` | `/v1/upload-sessions/{session_id}/files/refresh-url` | any authenticated | `write` | none | `RefreshUploadUrlRequest` | `RefreshUploadUrlResponse` |
| `POST` | `/v1/upload-sessions/{session_id}/finalize` | any authenticated | `write` | required | - | `FinalizeUploadSessionResponse` |
| `DELETE` | `/v1/upload-sessions/{session_id}` | any authenticated | `write` | required | - | `AbandonUploadSessionResponse` |

Create reserves `artifact_id` and `revision_id`, but does not create `artifacts` or `revisions` rows. The returned `put_url` values are opaque, short-lived URLs on the `upload` Worker, not R2 URLs. Clients PUT plaintext file bytes to those URLs; `upload` validates the signed URL and `Content-Length`, encrypts the request body before writing to R2, and records only the reserved final object key. Finalize verifies the encrypted R2 objects, creates the durable Unpublished Artifact when needed, and creates a `draft` Revision.

## Content Routes

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/v/{token}/{path}` | signed content token | File bytes or renderer page. |
| `GET` | `/v/{token}/_render/{mode}?path={path}` | signed content token | Platform renderer for Markdown and text modes. Directory mode is reserved pending the listing contract. |
| `GET` | `/b/{token}` | signed content token | Bundle bytes. |

Content authorization failures are generic `not_found`. Artifact Rate Limit failures return `429 rate_limited_artifact` with `Retry-After`. The content Worker never reads Postgres and never exposes R2 URLs.

## Operator Routes

Operator routes are served by `api` under `/admin/*`, reached through the `web` admin surface, and are not part of `/v1`.

| Method | Path | Auth | Idempotency | Request | Response |
|---|---|---|---|---|---|
| `POST` | `/admin/lockdowns` | operator | required | `PlatformLockdownRequest` | `PlatformLockdownResponse` |
| `GET` | `/admin/lockdowns` | operator | none | `PaginationRequest` | `PlatformLockdownListResponse` |
| `DELETE` | `/admin/lockdowns/{platform_lockdown_id}` | operator | required | - | `LiftPlatformLockdownResponse` |
| `POST` | `/admin/rotations/{secret_name}` | operator | required | - | `SecretRotationResponse` |
| `GET` | `/admin/audit/recent` | operator | none | `PaginationRequest` | `AdminRecentAuditResponse` |

Every operator route rejects API Key authentication before scope checks, runs `requireOperator()`, and writes an Audit Event for mutations with `actor.type='platform'`.

## Publish Flow

1. CLI/API client calls `POST upload /v1/upload-sessions`.
2. Client PUTs files to returned signed upload-worker URLs. No client receives an R2 write URL.
3. Client calls `POST upload /v1/upload-sessions/{session_id}/finalize`.
4. Client calls `POST api /v1/artifacts/{artifact_id}/publish`.
5. `api` creates the required Revision Link, optional Share Link, signs content URLs, enqueues bundle generation and safety scan, and returns `PublishResult`.

One user-visible publish uses one idempotency key threaded through the three durable operations with operation names from `runCommand`.
