# API Contract

This document describes the CLI-first MVP route contract. The canonical code registry lives in `packages/contracts`.

## Hosts

| Surface | Host | Owns |
|---|---|---|
| `api` | `https://api.agent-paste.sh` | API-key auth, public Agent View, artifact metadata, admin REST APIs, operation events, cleanup. |
| `upload` | `https://upload.agent-paste.sh` | Upload sessions, signed upload-worker PUT URLs, R2 writes, finalize validation. |
| `content` | `https://usercontent.agent-paste.sh` | Signed-token content reads from private R2. |

Future hosts:

| Surface | Status |
|---|---|
| `web` | Future dashboard/viewer surface, not MVP. |
| `mcp` | Future OAuth-only MCP server, not MVP. |

Preview hosts use the same path contracts with preview-specific hostnames and secrets.

## Headers

| Header | Direction | Required | Notes |
|---|---|---|---|
| `Authorization: Bearer ...` | request | Public CLI and admin routes | API key for `/v1/*`; admin token for `/admin/*`. |
| `Idempotency-Key` | request | Durable mutations | Required for upload session create/finalize and admin destructive commands where noted. |
| `X-Request-Id` | request/response | Optional request, always response | Server generates one when omitted. |
| `Retry-After` | response | 429 | Seconds. |

Secrets are never accepted as query parameters or flags.

## Auth Labels

| Label | Meaning |
|---|---|
| `api_key` | `Authorization: Bearer ap_pk_...` from `AGENT_PASTE_API_KEY`. |
| `admin_token` | `Authorization: Bearer ...` from `AGENT_PASTE_ADMIN_TOKEN`. |
| `signed_upload_url` | Opaque upload-worker URL minted by `upload`; accepts file bytes only. |
| `signed_agent_view_token` | Public token in `/v1/public/agent-view/{token}`. |
| `signed_content_token` | Public token in `/v/{token}/{path}`. |

## Public API Routes

| Method | Path | Auth | Idempotency | Request | Response |
|---|---|---|---|---|---|
| `GET` | `/v1/whoami` | `api_key` | none | - | `WhoamiResponse` |
| `GET` | `/v1/public/agent-view/{token}` | `signed_agent_view_token` | none | - | `AgentView` |

`whoami` returns the workspace id/name, API key id/name, and effective caps. It does not return API-key secret material.

`AgentView` is public to anyone with the signed token. It returns full per-file signed content URLs, not `content_prefix`.

## Upload Routes

| Method | Path | Auth | Idempotency | Request | Response |
|---|---|---|---|---|---|
| `POST` | `/v1/upload-sessions` | `api_key` | required | `CreateUploadSessionRequest` | `CreateUploadSessionResponse` |
| `PUT` | `/v1/upload-sessions/{session_id}/files/{path}` | `signed_upload_url` | none | file bytes | empty |
| `POST` | `/v1/upload-sessions/{session_id}/finalize` | `api_key` | required | - | `PublishResult` |

### `CreateUploadSessionRequest`

```json
{
  "title": "demo",
  "ttl_seconds": 2592000,
  "entrypoint": "index.html",
  "files": [
    {
      "path": "index.html",
      "size_bytes": 12345
    }
  ]
}
```

Rules:

- `title` is plain text.
- `ttl_seconds` must be between `1d` and `90d`.
- Single HTML publishes use the file name as `entrypoint`.
- Folder publishes require `index.html`.
- Paths are normalized POSIX paths.
- Max file size is `10 MB`.
- Max total size is `25 MB`.
- Max file count is `100`.

### `CreateUploadSessionResponse`

```json
{
  "upload_session_id": "upl_...",
  "artifact_id": "art_...",
  "revision_id": "rev_...",
  "expires_at": "2026-05-21T12:00:00.000Z",
  "files": [
    {
      "path": "index.html",
      "put_url": "https://upload.agent-paste.sh/v1/upload-sessions/upl_.../files/index.html?..."
    }
  ]
}
```

The returned `put_url` values are opaque upload-worker URLs. They are not R2 URLs.

### `PublishResult`

```json
{
  "artifact_id": "art_...",
  "revision_id": "rev_...",
  "title": "demo",
  "view_url": "https://usercontent.agent-paste.sh/v/{content_token}/index.html",
  "agent_view_url": "https://api.agent-paste.sh/v1/public/agent-view/{agent_view_token}",
  "expires_at": "2026-06-19T12:00:00.000Z"
}
```

Finalize verifies every expected file exists in R2, creates the artifact metadata, records file metadata, emits operation events, signs the URLs, and returns `PublishResult`.

## Content Routes

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/v/{token}/{path}` | `signed_content_token` | Serves one artifact file from private R2. |

Content authorization failures return generic `404 { "code": "not_found" }`.

Content checks:

- Token parse and signature.
- Token expiration.
- Token scope.
- KV denylist keys for artifact/revision when present.
- Requested path is within the signed revision.

The content Worker never reads Postgres and never exposes R2 URLs.

## Admin Routes

Admin routes are served by `api` under `/admin/*`. They are internal operations APIs used by the repo-local admin CLI.

| Method | Path | Auth | Idempotency | Request | Response |
|---|---|---|---|---|---|
| `POST` | `/admin/workspaces` | `admin_token` | required | `CreateWorkspaceRequest` | `WorkspaceDetail` |
| `GET` | `/admin/workspaces` | `admin_token` | none | `PaginationRequest` | `WorkspaceListResponse` |
| `POST` | `/admin/workspaces/{workspace_id}/api-keys` | `admin_token` | required | `CreateApiKeyRequest` | `CreateApiKeyResponse` |
| `DELETE` | `/admin/api-keys/{api_key_id}` | `admin_token` | required | - | `RevokeApiKeyResponse` |
| `GET` | `/admin/artifacts` | `admin_token` | none | filters | `AdminArtifactListResponse` |
| `GET` | `/admin/artifacts/{artifact_id}` | `admin_token` | none | - | `AdminArtifactDetail` |
| `DELETE` | `/admin/artifacts/{artifact_id}` | `admin_token` | required | - | `DeleteArtifactResponse` |
| `POST` | `/admin/cleanup/run` | `admin_token` | required | `CleanupRunRequest` | `CleanupRunResponse` |
| `GET` | `/admin/operation-events` | `admin_token` | none | filters | `OperationEventListResponse` |

Admin destructive commands must record operation events and must never log signed URLs, content tokens, API-key secrets, or admin tokens.

## Publish Flow

1. CLI validates local input and computes file metadata.
2. CLI calls `POST upload /v1/upload-sessions`.
3. CLI PUTs each file to returned upload-worker URLs.
4. CLI calls `POST upload /v1/upload-sessions/{session_id}/finalize`.
5. `upload` verifies files and completes the artifact through the API worker boundary.
6. CLI prints `PublishResult`.

MVP publish creates a new artifact every time. Updating an existing artifact is a future phase.
