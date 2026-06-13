# API Contract

This document describes the hosted route contract. The canonical code registry
lives in `packages/contracts`.

## Hosts

| Surface   | Host                                 | Owns                                                                                                                 |
| --------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `api`     | `https://api.agent-paste.sh`         | Authenticated CLI/MCP control plane, Agent View, artifact metadata, web/operator routes, billing, and ephemeral API. |
| `upload`  | `https://upload.agent-paste.sh`      | Upload Sessions, signed upload-worker PUT URLs, R2 writes, and finalize validation.                                  |
| `content` | `https://usercontent.agent-paste.sh` | Signed file and Bundle reads from private R2.                                                                        |
| `web`     | `https://app.agent-paste.sh`         | Dashboard, Access Link viewer, WorkOS auth, claim, and billing UI.                                                   |
| `mcp`     | `https://mcp.agent-paste.sh`         | OAuth-only Streamable HTTP MCP.                                                                                      |
| `apex`    | `https://agent-paste.sh`             | Marketing, legal, install scripts, agent text surfaces, and public docs.                                             |

Preview hosts use the same path contracts with preview-specific hostnames and secrets.

## Public OpenAPI

`GET https://api.agent-paste.sh/openapi.json` is the public API document. It
describes the user, agent, dashboard, billing, ephemeral, and public signed-token
routes that clients can integrate with directly.

Operator routes under `/v1/web/admin/*` are intentionally omitted from the
public OpenAPI document, along with their Cloudflare Access service-token scheme
and operator-only schemas. They remain runtime route contracts and are documented
only in [admin operations](./admin.md) and ops runbooks.

## Headers

| Header                      | Direction        | Required                          | Notes                                                                                          |
| --------------------------- | ---------------- | --------------------------------- | ---------------------------------------------------------------------------------------------- |
| `Authorization: Bearer ...` | request          | Authenticated routes              | Stored CLI credential, WorkOS bearer for `/v1/web/*` and operator routes, or MCP OAuth bearer. |
| `Idempotency-Key`           | request          | Durable mutations                 | Required for upload session create/finalize and other mutations where noted.                   |
| `X-Request-Id`              | request/response | Optional request, always response | Server generates one when omitted.                                                             |
| `Retry-After`               | response         | 429                               | Seconds.                                                                                       |

Secrets are never accepted as query parameters or flags.

## Auth Labels

| Label                     | Meaning                                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `cli_credential`          | Stored local CLI credential created by `agent-paste login` or by the ephemeral provision flow.             |
| `mcp_oauth`               | WorkOS AuthKit/Connect access token minted for the MCP resource indicator, resolved to a Workspace Member. |
| `cli_or_mcp`              | Either CLI credential auth or `mcp_oauth`; route scope checks apply to the resolved actor.                 |
| `workos_bearer`           | WorkOS AuthKit access token on `/v1/web/*` and operator lockdown routes.                                   |
| `signed_upload_url`       | Opaque upload-worker URL minted by `upload`; accepts file bytes only.                                      |
| `signed_agent_view_token` | Public token in `/v1/public/agent-view/{token}`.                                                           |
| `signed_content_token`    | Public token in `/v/{token}/{path}`.                                                                       |

The route registry still uses older internal guard identifiers for some CLI
credential routes. Agent-facing guidance should use the CLI or MCP surfaces, not
direct hosted route calls.

## Request Guard Order

Authenticated `api` and `upload` routes enforce guards in a fixed order
([ADR 0039](../adr/0039-authenticated-rate-limits-under-usage-policy.md),
[ADR 0064](../adr/0064-native-ratelimit-bindings-for-authenticated-counters.md)):

1. Authentication. Failures return `401` (or `404` for signed-token routes)
   before anything else runs or counts against any budget.
2. Scope enforcement. Missing scopes return `403` before idempotency replay and
   before rate limiting, so a key with revoked scopes is never served a cached
   replay and `403` takes precedence over `429`.
3. Completed idempotency replay. A cached completed response is returned without
   consuming Actor Rate Limit or Workspace Burst Cap budget.
4. Rate limits. Breaches return `429` with `Retry-After`.

## Public API Routes

| Method | Path                                                          | Auth                      | Idempotency | Request | Response               |
| ------ | ------------------------------------------------------------- | ------------------------- | ----------- | ------- | ---------------------- |
| `GET`  | `/v1/whoami`                                                  | `cli_credential`          | none        | -       | `WhoamiResponse`       |
| `GET`  | `/v1/mcp/whoami`                                              | `mcp_oauth`               | none        | -       | `McpWhoamiResponse`    |
| `GET`  | `/v1/artifacts/{artifact_id}/revisions`                       | `cli_or_mcp`              | none        | -       | `RevisionListResponse` |
| `POST` | `/v1/artifacts/{artifact_id}/revisions/{revision_id}/publish` | `cli_or_mcp`              | required    | -       | `PublishResult`        |
| `GET`  | `/v1/public/agent-view/{token}`                               | `signed_agent_view_token` | none        | -       | `PublicAgentView`      |

`whoami` returns the workspace id/name, actor, credential id/name, and effective caps. It does not return credential secret material.

`mcp.whoami` returns the authenticated Workspace Member, workspace, and granted MCP scopes derived from the member record.

`PublicAgentView` is public to anyone with the signed token. It returns full per-file signed content URLs, not `content_prefix`, and does not include lockdown metadata. Authenticated owner/member Agent View routes may include explicit lockdown metadata for dashboard-visible locked Artifacts.

## Upload Routes

| Method | Path                                            | Auth                | Idempotency | Request                      | Response                        |
| ------ | ----------------------------------------------- | ------------------- | ----------- | ---------------------------- | ------------------------------- |
| `POST` | `/v1/upload-sessions`                           | `cli_or_mcp`        | required    | `CreateUploadSessionRequest` | `CreateUploadSessionResponse`   |
| `PUT`  | `/v1/upload-sessions/{session_id}/files/{path}` | `signed_upload_url` | none        | file bytes                   | empty                           |
| `POST` | `/v1/upload-sessions/{session_id}/finalize`     | `cli_or_mcp`        | required    | -                            | `FinalizeUploadSessionResponse` |

### `CreateUploadSessionRequest`

```json
{
  "title": "demo",
  "entrypoint": "index.html",
  "render_mode": "html",
  "files": [
    {
      "path": "index.html",
      "size_bytes": 12345,
      "sha256": "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    }
  ]
}
```

Rules:

- `title` is plain text.
- Artifact lifetime is derived from server-side Workspace/Plan policy, not from
  client input.
- Single-file publishes use the file name as `entrypoint`.
- Folder publishes require an explicit or inferred `entrypoint`.
- `render_mode` is optional: one of `html`, `markdown`, `text`, `image`,
  `audio`, `video`. When present it is stored on the Upload Session and copied
  verbatim to the draft Revision at finalize, overriding inference. When absent
  the server infers the Render Mode from the entrypoint extension via the
  shared map in `packages/contracts/src/renderMode.ts`, falling back to `html`
  for unknown extensions. The CLI uses the same map locally but does not fall
  back: an unknown extension fails the publish with an error asking for an
  explicit `--render-mode`.
- Paths are normalized POSIX paths.
- Max file size is `10 MB`.
- Max total size is `25 MB`.
- Max file count is `100`.
- `sha256` is optional for compatibility. New CLI/MCP clients send lowercase
  hex SHA-256 for each file. Legacy clients that omit it keep the full-upload
  revision-object path and do not participate in deduplication.

### `CreateUploadSessionResponse`

```json
{
  "upload_session_id": "upl_...",
  "artifact_id": "art_...",
  "revision_id": "rev_...",
  "expires_at": "2026-05-21T12:00:00.000Z",
  "files": [
    {
      "status": "upload_required",
      "path": "index.html",
      "put_url": "https://upload.agent-paste.sh/v1/upload-sessions/upl_.../files/index.html?...",
      "required_headers": {},
      "expires_at": "2026-05-20T12:15:00.000Z"
    },
    {
      "status": "reused",
      "path": "style.css"
    }
  ]
}
```

The returned `put_url` values are opaque upload-worker URLs. They are not R2 URLs.
`upload_required` means the client must PUT the file bytes. `reused` means the
workspace already has a verified blob for the same `(sha256, size_bytes)`, or the
same upload session already requires that blob once; the client must skip PUT for
that path. Signed upload tokens include the expected `sha256` when the request
provided one, and the upload Worker rejects plaintext whose computed digest does
not match.

The top-level `expires_at` is the Upload Session expiry. Each `files[].expires_at`
is the validity of that file's signed `put_url` (the signed token's expiry, much
shorter than the session lifetime); a PUT after it returns `not_authenticated`
even while the session is still open.

### `PublishResult`

```json
{
  "artifact_id": "art_...",
  "revision_id": "rev_...",
  "title": "demo",
  "artifact_url": "https://app.agent-paste.sh/artifacts/art_...",
  "revision_content_url": "https://usercontent.agent-paste.sh/v/{content_token}/index.html",
  "agent_view_url": "https://api.agent-paste.sh/v1/public/agent-view/{agent_view_token}",
  "expires_at": "2026-06-19T12:00:00.000Z",
  "bundle": {
    "status": "pending",
    "retry_after_seconds": 5
  }
}
```

Finalize verifies every expected file exists in R2 and returns a draft Revision
summary. Publishing the finalized Revision creates or updates the published
Artifact state, signs the URLs, and returns `PublishResult`.

`artifact_url` is the authenticated **Artifact URL** for owner/member
management and the default post-publish `View`. `revision_content_url` is the
direct signed Content Origin URL for the exact `revision_id` returned in this
response, expires with its signed token, and does not Live Update. Direct
`usercontent` HTML is inert raw byte delivery unless it is loaded through the
controlled Artifact Viewer iframe. `access_link_url` appears only when a
**Share Link** or **Revision Link** is explicitly created. CLI `--share` creates
a Share Link and includes `access_link_url` in the publish result. MCP publish
tools return a narrower output with title, expiry,
and upload stats; they include `access_link_url` only when called with
`share: true`.

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

Human operators and rotation agents use WorkOS operator auth or Cloudflare Access service tokens on `/v1/web/admin/*` (see [admin operations](./admin.md) and [ADR 0046](../adr/0046-operator-identity-and-web-admin-surface.md)). The legacy repo-local `ADMIN_TOKEN` `/admin/*` contract was removed in AP-13.

## Publish Flow

1. CLI validates local input and computes file metadata, including SHA-256 for
   hash-aware clients.
2. CLI or MCP calls `POST upload /v1/upload-sessions`.
3. CLI PUTs only `upload_required` files to returned upload-worker URLs and skips
   `reused` files.
4. CLI or MCP calls `POST upload /v1/upload-sessions/{session_id}/finalize`.
5. `upload` verifies files and returns the finalized draft Revision.
6. CLI or MCP calls `POST api /v1/artifacts/{artifact_id}/revisions/{revision_id}/publish`.
7. CLI human output prints `View` with the authenticated Artifact URL; CLI JSON output returns `PublishResult`.

Publishing without `--artifact-id` creates a new Artifact. Publishing with an
existing `artifact_id` creates and publishes a new Revision for that Artifact.
The previous `revision_content_url` continues to point at the older Revision.
A Share Link remains the explicit public/shareable live viewer grant for the
Artifact. Its Access Link Signed URL is the user-facing public URL when a caller
asks to share. The `artifact_url` remains the authenticated app URL for
Workspace members.

Workspace-wide publish deduplication starts only for new hash-aware uploads after
the digest-manifest contract shipped. There is no historical backfill of legacy
revision-key objects.
