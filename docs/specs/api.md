# API Contract

This document describes the hosted route contract. The canonical code registry
lives in `packages/contracts`.

## Hosts

| Surface   | Host                                                                    | Owns                                                                                                                 |
| --------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `api`     | `https://api.agent-paste.sh`                                            | Authenticated CLI/MCP control plane, Agent View, artifact metadata, web/operator routes, billing, and ephemeral API. |
| `upload`  | `https://upload.agent-paste.sh`                                         | Upload Sessions, signed upload-worker PUT URLs, R2 writes, and finalize validation.                                  |
| `content` | `https://{id}.agent-paste.link`, `https://usercontent.agent-paste.link` | Capability websites and legacy signed file reads from private R2.                                                    |
| `web`     | `https://app.agent-paste.sh`                                            | Dashboard, WorkOS auth, claim, and billing UI.                                                                       |
| `mcp`     | `https://mcp.agent-paste.sh`                                            | OAuth-only Streamable HTTP MCP.                                                                                      |
| `apex`    | `https://agent-paste.sh`                                                | Marketing, legal, install scripts, agent text surfaces, and public docs.                                             |

Preview hosts use the same path contracts with preview-specific hostnames and secrets.

## Public OpenAPI

`GET https://api.agent-paste.sh/openapi.json` is the public API document. It
describes the user, agent, dashboard, billing, ephemeral, and public signed-token
routes that clients can integrate with directly.

Operator routes under `/v1/web/admin/*` are intentionally omitted from the
public OpenAPI document, along with their Cloudflare Access service-token scheme
and operator-only schemas. They remain runtime route contracts and are documented
only in [admin operations](./admin.md) and ops runbooks.

## API Discovery

`apex` is the discovery root for agents that arrive at `https://agent-paste.sh`
with no prior knowledge of the product. The homepage response carries an
[RFC 8288](https://www.rfc-editor.org/rfc/rfc8288) `Link` header with registered
relations only:

| Relation       | Target                                    | Media type                    |
| -------------- | ----------------------------------------- | ----------------------------- |
| `api-catalog`  | `/.well-known/api-catalog`                | `application/linkset+json`    |
| `service-desc` | `https://api.agent-paste.sh/openapi.json` | `application/json`            |
| `service-doc`  | `/docs`                                   | `text/html`                   |
| `describedby`  | `/agents.md`, `/llms.txt`                 | `text/markdown`, `text/plain` |

`GET https://agent-paste.sh/.well-known/api-catalog` returns the
[RFC 9727](https://www.rfc-editor.org/rfc/rfc9727) API catalog as a
[Linkset](https://www.rfc-editor.org/rfc/rfc9264) document
(`application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"`).
It anchors an `item` list of the two integrable APIs (`api` and `mcp`) and gives
each one a `service-desc` and `service-doc` target. Both surfaces are generated
in `apps/apex/src/discovery.ts`, so the catalog and the header cannot drift.

Cross-origin targets are baked from `AGENT_PASTE_ENV`, so the preview build
advertises the preview hosts.

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
| `GET`  | `/.well-known/oauth-authorization-server` | none            | OAuth metadata with configured `agent_auth` endpoints and capabilities.             |
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
Provider event metadata (`events_endpoint`, `events_supported`, and
`identity_assertion`) is advertised only with the verified flow; anonymous-only
deployments must not publish those fields.

Agent-auth access tokens are short-lived `ap_pk_*` credentials with `read` and
`publish` scopes. They are issued only by `/oauth2/token`; `/agent/identity`
returns a service-signed `identity_assertion`, never a bearer credential.
Anonymous pre-claim credentials inherit the Ephemeral Workspace trust tier:
low-cap writes, 24-hour Auto Deletion, `noindex`, and no admin/billing scope.
Artifact scripts execute on isolated capability origins under the open artifact
CSP. Existing-user ID-JAG matches without a stored provider delegation require
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

`PublicAgentView` is public to anyone with the signed token. It resolves one exact Revision and returns full per-file signed URLs for that Revision, not `content_prefix`; those links stay on the legacy content route during the serialized rollout so later capability-manifest updates cannot make the files disagree with the returned metadata. It does not include lockdown metadata. Authenticated owner/member Agent View routes use the same exact-Revision file-link rule and may include explicit lockdown metadata for dashboard-visible locked Artifacts.

The authenticated member `AgentView` additionally carries `url`, the same stable top-level capability URL returned by publish. `PublicAgentView` remains an exact-Revision metadata contract and does not carry that moving Artifact URL.

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
- File and total Revision size enforcement uses the caller's effective **Usage
  Policy**. Current public tier values are Ephemeral/Free: `10 MB` per file and
  `25 MB` per Revision; Pro: `25 MB` per file and `100 MB` per Revision.
  Authenticated caps are exposed by `GET /v1/usage-policy`. The request schema
  also has a `25 MB` per-file hard ceiling so no client can submit a larger
  individual file entry.
- Max file count is `100` per Revision.
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
  "url": "https://0123456789abcdef0123456789abcdef.agent-paste.link/",
  "expires_at": "2026-06-19T12:00:00.000Z"
}
```

Finalize verifies every expected file exists in R2 and returns a draft Revision
summary. Publishing the finalized Revision creates or updates the published
Artifact state, signs the URLs, and returns `PublishResult`.

`url` is the only recipient link. It opens without login as a top-level website,
uses a durable per-Artifact capability hostname, and advances to the latest
Published Revision when the same Artifact is revised. The `expires_at` field is
the Artifact content lifetime. The dashboard-only Artifact Console at
`/artifacts/{artifact_id}` is never returned by publish.

There is no visibility input, `shared` bit, private viewer URL, Access Link URL,
or second sharing command. CLI, MCP, authenticated publish, and ephemeral
publish all use this contract. Ephemeral provisioning may additionally return
claim fields, but it does not replace or wrap `url`.

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
7. CLI human output prints `View` with `url`; CLI JSON output returns `PublishResult`.

Publishing without `--artifact-id` creates a new Artifact. Publishing with an
existing `artifact_id` creates and publishes a new Revision for that Artifact.
The Artifact's existing capability URL advances to the new Published Revision
without changing. A production or preview publish fails loudly if the API cannot
write and return the capability URL. Local development may use its configured
artifact test domain.

Workspace-wide publish deduplication starts only for new hash-aware uploads after
the digest-manifest contract shipped. There is no historical backfill of legacy
revision-key objects.
