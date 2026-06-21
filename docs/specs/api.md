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
direct hosted route calls, unless the agent is implementing the auth.md HTTP
client flow below.

## Agent Auth Discovery

The API Worker publishes the WorkOS auth.md discovery surface for agent sign-up:

| Method | Path                                      | Auth            | Purpose                                                                             |
| ------ | ----------------------------------------- | --------------- | ----------------------------------------------------------------------------------- |
| `GET`  | `/auth.md`                                | none            | Human/agent-readable summary of supported agent auth.                               |
| `GET`  | `/.well-known/oauth-protected-resource`   | none            | Protected Resource Metadata with the API resource and authorization server.         |
| `GET`  | `/.well-known/oauth-authorization-server` | none            | OAuth metadata with `agent_auth` endpoints and supported event schemas.             |
| `POST` | `/agent/identity`                         | none            | WorkOS auth.md registration for anonymous user-claimed starts and provider ID-JAGs. |
| `POST` | `/agent/identity/claim`                   | none            | Starts an anonymous claim attempt or looks up a first-link step-up claim token.     |
| `POST` | `/oauth2/token`                           | none            | JWT-bearer exchange for a service-signed `identity_assertion`, plus claim polling.  |
| `POST` | `/oauth2/revoke`                          | none            | Idempotent revocation of one agent-auth access token.                               |
| `POST` | `/agent/event/notify`                     | none            | Provider Security Event Token receiver for identity-assertion revocation.           |
| `POST` | `/v1/web/agent-auth/claim/complete`       | `workos_bearer` | Signed-in first-link confirmation from the dashboard.                               |

The anonymous user-claimed flow is advertised when `api` has
`AGENT_AUTH_ASSERTION_SIGNING_SECRET`. `POST /agent/identity` with
`{ "type": "anonymous" }` creates an Ephemeral Workspace-backed registration,
returns a service-signed `identity_assertion`, and returns an opaque
`claim_token` held by the agent. Its `claim_url` field is the API claim endpoint,
not the browser URL. The agent exchanges the assertion at `/oauth2/token` for a
short-lived pre-claim `ap_pk_*` credential scoped only to that Ephemeral
Workspace.

To bind the anonymous registration, the agent calls `/agent/identity/claim` with
`{ claim_token }`. The API returns a six-digit `user_code` and a browser
`verification_uri` containing a separate `claim_attempt_token`; the original
`claim_token` is not sent to the browser. `/v1/web/agent-auth/claim/complete`
requires a signed-in WorkOS user and the matching code. That browser session
chooses the destination Workspace. On success the existing Ephemeral Workspace
claim path reparents Artifacts into that user's Workspace, records the completed
claim on the agent-auth registration, and revokes all source-workspace API keys,
including pre-claim agent-auth tokens. The agent's claim-token grant returns
`authorization_pending` until this browser completion succeeds, then returns a
user-backed access token.

The agent-verified `identity_assertion` flow is additionally advertised only
when `AGENT_AUTH_TRUSTED_PROVIDERS_JSON` parses to at least one trusted
provider. The trust list is JSON configured by operators and must include
issuer, display name, and accepted provider `client_ids`. `service_auth`
registrations are intentionally not advertised or accepted.

Agent-auth access tokens are short-lived `ap_pk_*` credentials with `read` and
`publish` scopes. They are issued only by `/oauth2/token`; `/agent/identity`
returns a service-signed `identity_assertion`, never a bearer credential.
Anonymous pre-claim credentials inherit the Ephemeral Workspace trust tier:
low-cap writes, script-disabled serving while unclaimed, and no admin/billing
scope. Existing-user ID-JAG matches without a stored provider delegation require
first-link step-up in the dashboard before the delegation is bound. No-match
ID-JAGs JIT provision a normal Personal Workspace using a synthetic
`agent-auth:` member id and a durable provider delegation, so later ID-JAGs for
the same `(iss, sub, aud)` resume the same account.

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
| `GET`  | `/v1/artifacts/{artifact_id}/file-content`                    | `cli_or_mcp`              | none        | -       | `ArtifactFileContent`  |
| `POST` | `/v1/artifacts/{artifact_id}/revisions/{revision_id}/publish` | `cli_or_mcp`              | required    | -       | `PublishResult`        |
| `GET`  | `/v1/public/agent-view/{token}`                               | `signed_agent_view_token` | none        | -       | `PublicAgentView`      |

`whoami` returns the workspace id/name, actor, credential id/name, and effective caps. It does not return credential secret material.

`mcp.whoami` returns the authenticated Workspace Member, workspace, and granted MCP scopes derived from the member record.

`PublicAgentView` is public to anyone with the signed token. It returns full per-file signed content URLs, not `content_prefix`, and does not include lockdown metadata. Authenticated owner/member Agent View routes may include explicit lockdown metadata for dashboard-visible locked Artifacts.

The authenticated member `AgentView` additionally carries `private_url` — the login-walled clean viewer (`/v/<artifactId>`) for the Workspace Member ([ADR 0091](../adr/0091-client-side-revise-engine-and-literal-edit-tools.md)). It is **member-only**: it is absent from `PublicAgentView`, and the access-link resolve path (a public/Share-Link viewer, which still passes a `workspaceId` to sign content tokens) does not emit it — the API gates it on an explicit `includePrivateUrl` opt-in set only by the authenticated member route, so a private viewer link never reaches an anonymous viewer.

`file-content` reads one stored file's decrypted plaintext for the owning Workspace Member so an agent can diff against it and revise with a unified-diff patch ([ADR 0090](../adr/0090-agent-file-read-back-api-decrypts-member-plaintext.md)). Inputs: `?path=` (required; query, not a path segment, since a file path may contain `/`) and `?revision_id=` (optional; defaults to latest). The response `ArtifactFileContent` is `{ path, sha256, size_bytes, content_type, is_binary, body? }`: `body` is the decoded UTF-8 text and is present only when the file is text and `≤ 10 MiB`. `is_binary` is byte-derived (true binary only); a text file over the inline cap returns `is_binary: false` with `body` absent (the agent fetches it via the content URL or uploads a whole blob), and an oversize file is returned as metadata **without reading R2**. This is the only `api` route that decrypts artifact bytes; the blob key is derived from the RLS-scoped row's plaintext `sha256` plus the actor's workspace, never from client input, and a missing/undecryptable blob is `storage_unavailable` (503), never `not_found`. `AgentView` file entries also carry an optional plaintext `sha256` so an agent can detect what changed before reading a file back.

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
  "base_revision_id": "rev_...",
  "deleted_paths": ["old/page.html"],
  "files": [
    {
      "path": "index.html",
      "size_bytes": 12345,
      "sha256": "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    },
    {
      "path": "big.txt",
      "size_bytes": 240,
      "patch": {
        "base_sha256": "<digest of big.txt in the base Revision>",
        "format": "unified",
        "result_sha256": "<digest of the whole reconstructed big.txt>"
      }
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
  `audio`, `video`. Finalize resolves the draft Revision's Render Mode as
  `session.render_mode ?? base Revision's render_mode ?? infer(entrypoint)`
  ([ADR 0091](../adr/0091-client-side-revise-engine-and-literal-edit-tools.md)): an explicit client value
  on the Upload Session wins; otherwise a partial-manifest revise against a
  `base_revision_id` **inherits the base Revision's mode** rather than re-inferring
  from the entrypoint (so a body-only patch of a `markdown` Artifact stays
  `markdown`); a fresh publish with no base infers from the entrypoint extension
  via the shared map in `packages/contracts/src/renderMode.ts`, falling back to
  `html` for unknown extensions. The CLI uses the same map locally but does not
  fall back: an unknown extension fails the publish with an error asking for an
  explicit `--render-mode`.
- Paths are normalized POSIX paths.
- Max file size is `10 MB`.
- Max total size is `25 MB`.
- Max file count is `100`.
- `sha256` is optional for compatibility on whole-file entries. New CLI/MCP
  clients send lowercase hex SHA-256 for each whole-file entry; legacy clients
  that omit it keep the full-upload revision-object path and do not participate
  in deduplication. A patched entry must NOT carry `sha256` (its uploaded bytes
  are the diff, not the content-addressed file); the request is rejected if it
  declares both.
- `base_revision_id`, `deleted_paths`, and per-file `patch` are the optional
  commit-chain / partial-manifest inputs ([ADR 0089](../adr/0089-revision-commit-chain-tree-inheritance-and-server-reconstructed-delta.md)).
  When `base_revision_id` is set, `files` lists only changed and added paths,
  `deleted_paths` drops paths, and every other path inherits from the base
  Revision by reference. A per-file `patch` (`{ base_sha256, format: "unified",
result_sha256 }`) means the bytes uploaded for that entry are a unified diff
  rather than the whole file: `size_bytes` is the diff's byte length and the
  entry carries no whole-file `sha256`, `base_sha256` is the digest of that path
  in the base Revision the diff applies to, and `result_sha256` is the digest of
  the whole reconstructed file the server produces and verifies. Structural rules
  enforced at request validation: `patch` and `deleted_paths` require
  `base_revision_id`; `deleted_paths` is unique; a path cannot be both uploaded
  and deleted; a patched entry cannot also declare a whole-file `sha256`;
  `format` must be `unified`. Stateful checks and the tree-inheritance merge run server-side at
  finalize. The base must be a `published` Revision in the same Workspace and
  Artifact (a cross-workspace base is reported as not found; a cross-artifact base
  is rejected before it could violate the parent foreign key). Only blob-backed
  base paths inherit; a legacy revision-scoped path must be re-uploaded. A deleted
  path must exist in the base, and a patch `base_sha256` must match the base file.
  At finalize the merged tree (inherited base rows + uploaded changes − deletions)
  sets `revisions.parent_revision_id = base_revision_id`, and `file_count` /
  `size_bytes` are recomputed from the merged tree, not the uploaded manifest.
  A patched file is reconstructed synchronously at finalize: the server applies the
  diff to the base blob, verifies the result digest equals `result_sha256`, and
  stores the whole result as an ordinary content-addressed blob — so caps are
  enforced against the reconstructed result size, not the diff. If the diff cannot
  be applied cleanly (base moved, hunk fails, or the result digest mismatches),
  finalize fails with `patch_conflict` (HTTP 422) and message
  `patch_conflict: <path>: <reason>` (`reason` ∈ `parse_error`,
  `base_hash_mismatch`, `apply_failed`, `result_hash_mismatch`); the caller
  regenerates that file's diff and re-finalizes. A broken patch never produces a
  servable Revision. A file may not declare both a whole-file `sha256` and a
  `patch`.

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
  "private_url": "https://app.agent-paste.sh/v/art_...",
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

Authenticated publish is **content-only and private**. `PublishResult` carries
no visibility input and no `shared` field, and there is no `access_link_url`
member.
`private_url` is the **Private Link** — the login-walled clean viewer at
`/v/<artifactId>` for the owning **Workspace Member** — and is the default
authenticated handoff link publish returns. It is **permanent and stable**: the URL is derived only
from the Artifact id with no token, signature, or expiry, and `add_revision`
republishes into the same id, so the link never changes across revisions and
live-updates to the latest Published Revision. It is **always private** (member
only) and stops resolving only when the
Artifact itself is deleted or swept by Auto Deletion — a property of the
Artifact's lifetime, not the link. The `expires_at` in `PublishResult` is the
Artifact's content lifetime, not a link expiry. The dashboard-only **Artifact
Console** at `/artifacts/<artifactId>` is never returned by publish. `revision_content_url` is
the direct signed Content Origin URL for the exact `revision_id` returned in this
response, expires with its signed token, and does not Live Update. Direct
`usercontent` HTML is inert raw byte delivery unless it is loaded through the
controlled Artifact Viewer iframe. MCP publish tools (`publish_artifact`,
`add_revision`) and CLI `publish` run the same publish path and return the same
shape: `private_url`, title, expiry, and upload stats. Creating an unlisted
no-login handoff is a separate explicit step: `set_visibility` with
`visibility: "unlisted"` on MCP, or
`agent-paste set-visibility <artifact-id> unlisted` on the CLI. It mints or
reuses the one revocable **Share Link** and returns `unlisted_url`, its no-login
**Access Link Signed URL**. Accountless `--ephemeral` publish is the exception:
because it has no human in the loop to run `set-visibility`, the coordinator
auto-creates the unlisted Share Link at finalize and returns `unlisted_url`
alongside the claim fields.
Creating a `share` Access Link is
idempotent on the Artifact, not just on the request key: if the Artifact already
has an active (non-revoked, unexpired) Share Link, create returns that same link
instead of minting a duplicate, so an Artifact has at most one live Share Link.
Revoking it lets the next `set_visibility unlisted` mint a fresh one. `revision`
Access Links are never deduped — each pins a specific Revision.

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
7. CLI human output prints `View` with the `private_url` (`/v/<artifactId>` clean viewer); CLI JSON output returns `PublishResult`.

Publishing without `--artifact-id` creates a new Artifact. Publishing with an
existing `artifact_id` creates and publishes a new Revision for that Artifact.
The previous `revision_content_url` continues to point at the older Revision.
Authenticated publish never creates unauthenticated access; a Share Link is
created only by the separate MCP `set_visibility` / CLI
`agent-paste set-visibility <artifact-id> unlisted` step. Accountless
`--ephemeral` publish auto-creates that Share Link and returns its Access Link
Signed URL as the user-facing `unlisted_url`. The `private_url` remains the
authenticated clean-viewer link for Workspace members.

Workspace-wide publish deduplication starts only for new hash-aware uploads after
the digest-manifest contract shipped. There is no historical backfill of legacy
revision-key objects.
