# API Contract

This document describes the hosted route contract. The canonical code registry
lives in `packages/contracts`.

## Hosts

| Surface   | Host                                 | Owns                                                                                          |
| --------- | ------------------------------------ | --------------------------------------------------------------------------------------------- |
| `api`     | `https://api.agent-paste.sh`         | API-key auth, Agent View, artifact metadata, web/operator routes, billing, and ephemeral API. |
| `upload`  | `https://upload.agent-paste.sh`      | Upload Sessions, signed upload-worker PUT URLs, R2 writes, and finalize validation.           |
| `content` | `https://usercontent.agent-paste.sh` | Signed file and Bundle reads from private R2.                                                 |
| `web`     | `https://app.agent-paste.sh`         | Dashboard, Access Link viewer, WorkOS auth, claim, and billing UI.                            |
| `mcp`     | `https://mcp.agent-paste.sh`         | OAuth-only Streamable HTTP MCP.                                                               |
| `apex`    | `https://agent-paste.sh`             | Marketing, legal, install scripts, agent text surfaces, and public docs.                      |

Preview hosts use the same path contracts with preview-specific hostnames and secrets.

## Headers

| Header                      | Direction        | Required                          | Notes                                                                                                    |
| --------------------------- | ---------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `Authorization: Bearer ...` | request          | Authenticated routes              | API key for API-key routes; WorkOS bearer for `/v1/web/*`, operator routes, and MCP OAuth member routes. |
| `Idempotency-Key`           | request          | Durable mutations                 | Required for upload session create/finalize and other mutations where noted.                             |
| `X-Request-Id`              | request/response | Optional request, always response | Server generates one when omitted.                                                                       |
| `Retry-After`               | response         | 429                               | Seconds.                                                                                                 |

Secrets are never accepted as query parameters or flags.

## Auth Labels

| Label                     | Meaning                                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `api_key`                 | `Authorization: Bearer ap_pk_...` from `AGENT_PASTE_API_KEY`.                                              |
| `mcp_oauth`               | WorkOS AuthKit/Connect access token minted for the MCP resource indicator, resolved to a Workspace Member. |
| `api_key_or_mcp_oauth`    | Either `api_key` or `mcp_oauth`; route scope checks apply to the resolved actor.                           |
| `workos_bearer`           | WorkOS AuthKit access token on `/v1/web/*` and operator lockdown routes.                                   |
| `signed_upload_url`       | Opaque upload-worker URL minted by `upload`; accepts file bytes only.                                      |
| `signed_agent_view_token` | Public token in `/v1/public/agent-view/{token}`.                                                           |
| `signed_content_token`    | Public token in `/v/{token}/{path}`.                                                                       |

## Public API Routes

| Method | Path                                    | Auth                      | Idempotency | Request | Response               |
| ------ | --------------------------------------- | ------------------------- | ----------- | ------- | ---------------------- |
| `GET`  | `/v1/whoami`                            | `api_key`                 | none        | -       | `WhoamiResponse`       |
| `GET`  | `/v1/mcp/whoami`                        | `mcp_oauth`               | none        | -       | `McpWhoamiResponse`    |
| `GET`  | `/v1/artifacts/{artifact_id}/revisions` | `api_key_or_mcp_oauth`    | none        | -       | `RevisionListResponse` |
| `GET`  | `/v1/public/agent-view/{token}`         | `signed_agent_view_token` | none        | -       | `PublicAgentView`      |

`whoami` returns the workspace id/name, API key id/name, and effective caps. It does not return API-key secret material.

`mcp.whoami` returns the authenticated Workspace Member, workspace, and granted MCP scopes derived from the member record.

`PublicAgentView` is public to anyone with the signed token. It returns full per-file signed content URLs, not `content_prefix`, and does not include lockdown metadata. Authenticated owner/member Agent View routes may include explicit lockdown metadata for dashboard-visible locked Artifacts.

## Upload Routes

| Method | Path                                            | Auth                   | Idempotency | Request                      | Response                      |
| ------ | ----------------------------------------------- | ---------------------- | ----------- | ---------------------------- | ----------------------------- |
| `POST` | `/v1/upload-sessions`                           | `api_key_or_mcp_oauth` | required    | `CreateUploadSessionRequest` | `CreateUploadSessionResponse` |
| `PUT`  | `/v1/upload-sessions/{session_id}/files/{path}` | `signed_upload_url`    | none        | file bytes                   | empty                         |
| `POST` | `/v1/upload-sessions/{session_id}/finalize`     | `api_key_or_mcp_oauth` | required    | -                            | `PublishResult`               |

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

| Method | Path                | Auth                   | Notes                                     |
| ------ | ------------------- | ---------------------- | ----------------------------------------- |
| `GET`  | `/v/{token}/{path}` | `signed_content_token` | Serves one artifact file from private R2. |

Content authorization failures return generic `404 { "code": "not_found" }`.

Content checks:

- Token parse and signature.
- Token expiration.
- Token scope.
- KV denylist keys for artifact/revision when present.
- Requested path is within the signed revision.

The content Worker never reads Postgres and never exposes R2 URLs.

## Operator Routes

Human operators and rotation agents use WorkOS operator auth or Cloudflare Access service tokens on `/v1/web/admin/lockdowns` (see [admin operations](./admin.md) and [ADR 0046](../adr/0046-operator-identity-and-web-admin-surface.md)). The legacy repo-local `ADMIN_TOKEN` `/admin/*` contract was removed in AP-13.

## Publish Flow

1. CLI validates local input and computes file metadata.
2. CLI or MCP calls `POST upload /v1/upload-sessions`.
3. CLI PUTs each file to returned upload-worker URLs.
4. CLI or MCP calls `POST upload /v1/upload-sessions/{session_id}/finalize`.
5. `upload` verifies files and completes the artifact through the API worker boundary.
6. CLI prints `PublishResult`.

Publishing without `--artifact-id` creates a new Artifact. Publishing with an
existing `artifact_id` creates and publishes a new Revision for that Artifact.
