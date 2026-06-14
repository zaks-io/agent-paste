# Data Model Spec

This is the schema target for the CLI-first MVP. Drizzle definitions should live in `packages/db`. The database is Postgres reached from Workers through Cloudflare Hyperdrive.

## Global Rules

- Tenant-owned tables include `workspace_id UUID NOT NULL`.
- Tenant-owned tables should be compatible with Postgres RLS from the first migration.
- Timestamps are `TIMESTAMPTZ`.
- Public IDs use the formats in [`contracts.md`](./contracts.md).
- Secrets are never stored plaintext.
- Signed content tokens and full signed URLs are never stored in normal metadata or operation-event details.
- Artifacts can have multiple revisions. `artifacts.revision_id` is the published-revision pointer only (`NULL` until first publish). Upload sessions and `artifact_files` rows reference a specific revision id.

## Tables

### `workspaces`

| Column          | Type                   | Notes                                                                                                                                                                                                                                                               |
| --------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`            | `UUID PRIMARY KEY`     | Tenant id.                                                                                                                                                                                                                                                          |
| `name`          | `TEXT NOT NULL`        | Operator supplied or inferred from email.                                                                                                                                                                                                                           |
| `contact_email` | `TEXT NULL`            | Operator-supplied MVP contact. Public OAuth membership is future work.                                                                                                                                                                                              |
| `claimed_at`    | `TIMESTAMPTZ NULL`     | Ephemeral-publish ([0075](../adr/0075-agent-first-ephemeral-publish-and-write-gated-monetization.md)): `NULL` while the tenant is unclaimed/ephemeral (ephemeral cap set); non-null marks it consumed by a claim. The timestamp is the state — no separate boolean. |
| `created_at`    | `TIMESTAMPTZ NOT NULL` |                                                                                                                                                                                                                                                                     |
| `updated_at`    | `TIMESTAMPTZ NOT NULL` |                                                                                                                                                                                                                                                                     |

A `workspaces` row with `claimed_at IS NULL` is an **Ephemeral Workspace**: a real RLS-scoped tenant owned by a reserved system actor with no **Workspace Member**, provisioned by the ephemeral-publish flow ([0075](../adr/0075-agent-first-ephemeral-publish-and-write-gated-monetization.md)).

### `claim_tokens`

One-time tokens that promote an **Ephemeral Workspace** ([0075](../adr/0075-agent-first-ephemeral-publish-and-write-gated-monetization.md)). RLS-scoped on `workspace_id` like every tenant table; the secret is stored hashed, never plaintext (parallels `api_keys.secret_hmac`, [ADR 0043](../adr/0043-bearer-credential-format-and-storage.md)).

| Column         | Type                                      | Notes                                                        |
| -------------- | ----------------------------------------- | ------------------------------------------------------------ |
| `id`           | `TEXT PRIMARY KEY`                        | `ct_...` (see [`contracts.md`](./contracts.md)).             |
| `workspace_id` | `UUID NOT NULL REFERENCES workspaces(id)` | The Ephemeral Workspace this token claims. RLS scope.        |
| `token_hash`   | `BYTEA NOT NULL`                          | HMAC of the claim-token secret with pepper. Never plaintext. |
| `pepper_kid`   | `SMALLINT NOT NULL`                       | Current pepper generation.                                   |
| `expires_at`   | `TIMESTAMPTZ NOT NULL`                    | Single-use and short-lived.                                  |
| `redeemed_at`  | `TIMESTAMPTZ NULL`                        | Set once on successful claim; a second redeem fails closed.  |
| `created_at`   | `TIMESTAMPTZ NOT NULL`                    |                                                              |

### `api_keys`

| Column         | Type                                      | Notes                                       |
| -------------- | ----------------------------------------- | ------------------------------------------- |
| `id`           | `TEXT PRIMARY KEY`                        | `key_...`.                                  |
| `workspace_id` | `UUID NOT NULL REFERENCES workspaces(id)` |                                             |
| `public_id`    | `TEXT NOT NULL UNIQUE`                    | Lookup segment from the bearer token.       |
| `name`         | `TEXT NOT NULL`                           | Operator assigned.                          |
| `secret_hmac`  | `BYTEA NOT NULL`                          | HMAC-SHA-256 of secret segment with pepper. |
| `pepper_kid`   | `SMALLINT NOT NULL`                       | Current pepper generation.                  |
| `revoked_at`   | `TIMESTAMPTZ NULL`                        |                                             |
| `expires_at`   | `TIMESTAMPTZ NULL`                        | Null means no key-level expiration.         |
| `last_used_at` | `TIMESTAMPTZ NULL`                        |                                             |
| `created_at`   | `TIMESTAMPTZ NOT NULL`                    |                                             |

Stored credentials grant the publish/read capability needed by the public CLI. Granular scopes are future work.

### `artifacts`

| Column                    | Type                                      | Notes                                                                                                                                                                                         |
| ------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                      | `TEXT PRIMARY KEY`                        | `art_...`.                                                                                                                                                                                    |
| `workspace_id`            | `UUID NOT NULL REFERENCES workspaces(id)` |                                                                                                                                                                                               |
| `revision_id`             | `TEXT NULL`                               | `rev_...`; published-revision pointer only. `NULL` until the first publish; not globally unique.                                                                                              |
| `status`                  | `TEXT NOT NULL`                           | `active`, `deleted`, or `expired`.                                                                                                                                                            |
| `title`                   | `TEXT NOT NULL`                           | Plain text.                                                                                                                                                                                   |
| `entrypoint`              | `TEXT NOT NULL`                           | Normalized file path.                                                                                                                                                                         |
| `file_count`              | `INTEGER NOT NULL`                        |                                                                                                                                                                                               |
| `size_bytes`              | `BIGINT NOT NULL`                         | Total uploaded bytes.                                                                                                                                                                         |
| `expires_at`              | `TIMESTAMPTZ NOT NULL`                    | Required.                                                                                                                                                                                     |
| `pinned_at`               | `TIMESTAMPTZ NULL`                        | Set while pinned; exempts from Auto Deletion.                                                                                                                                                 |
| `access_link_lockdown_at` | `TIMESTAMPTZ NULL`                        | Non-null while Access Link minting is locked for this Artifact. Blocks new share/revision links and writes KV denylist `ad:{artifactId}` with reason `access_link_lockdown`. Cleared on lift. |
| `created_by_type`         | `TEXT NOT NULL`                           | `api_key` or `member`.                                                                                                                                                                        |
| `created_by_id`           | `TEXT NOT NULL`                           | Creator id for the stored type.                                                                                                                                                               |
| `deleted_at`              | `TIMESTAMPTZ NULL`                        | Set for `deleted` and `expired`.                                                                                                                                                              |
| `delete_reason`           | `TEXT NULL`                               | `admin_delete`, `expired`, or future reason.                                                                                                                                                  |
| `created_at`              | `TIMESTAMPTZ NOT NULL`                    |                                                                                                                                                                                               |
| `updated_at`              | `TIMESTAMPTZ NOT NULL`                    |                                                                                                                                                                                               |

No artifact can be created without `expires_at`. While `pinned_at` is set, the
stored `expires_at` is retained but not enforced: the Auto Deletion sweep skips
the Artifact and reads (Agent Views, Access Links, dashboard viewer) do not
treat it as expired even when `expires_at` is in the past. Content tokens for
such an Artifact fall back to the default TTL instead of the stale expiry.
Unpinning re-arms the stored `expires_at` as-is.

### `revisions`

First-class revision rows for multi-revision Artifacts ([0009](../../packages/db/migrations/0009_revisions.sql)). Upload finalize creates a `draft`; publish assigns `revision_number`, sets `published_at`, and updates `artifacts.revision_id`.

| Column                     | Type                                                         | Notes                                                                                                                                                                                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                       | `TEXT PRIMARY KEY`                                           | `rev_...`.                                                                                                                                                                                                                                                                                             |
| `workspace_id`             | `UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT` | Tenant scope.                                                                                                                                                                                                                                                                                          |
| `artifact_id`              | `TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE`   | Parent Artifact; deleting the Artifact deletes its revisions.                                                                                                                                                                                                                                          |
| `parent_revision_id`       | `TEXT NULL`                                                  | Commit-chain parent ([0087](../adr/0087-revision-commit-chain-tree-inheritance-and-server-reconstructed-delta.md)); deferrable self-FK on `(workspace_id, artifact_id, parent_revision_id)` → `revisions(workspace_id, artifact_id, id)`, `ON DELETE SET NULL (parent_revision_id)`. `NULL` for roots. |
| `revision_number`          | `INTEGER NULL`                                               | Assigned on publish; unique per Artifact when not null. Null while `status = 'draft'`.                                                                                                                                                                                                                 |
| `status`                   | `TEXT NOT NULL`                                              | `draft`, `published`, or `retained`.                                                                                                                                                                                                                                                                   |
| `entrypoint`               | `TEXT NOT NULL`                                              | Normalized file path.                                                                                                                                                                                                                                                                                  |
| `render_mode`              | `TEXT NOT NULL DEFAULT 'html'`                               | `html`, `markdown`, `text`, `image`, `audio`, or `video`.                                                                                                                                                                                                                                              |
| `file_count`               | `INTEGER NOT NULL`                                           |                                                                                                                                                                                                                                                                                                        |
| `size_bytes`               | `BIGINT NOT NULL`                                            | Total uploaded bytes for this revision.                                                                                                                                                                                                                                                                |
| `bundle_status`            | `TEXT NOT NULL DEFAULT 'disabled'`                           | `pending`, `ready`, `failed`, or `disabled`.                                                                                                                                                                                                                                                           |
| `bundle_status_updated_at` | `TIMESTAMPTZ NULL`                                           |                                                                                                                                                                                                                                                                                                        |
| `bundle_size_bytes`        | `BIGINT NULL`                                                | Encrypted bundle size when `bundle_status = 'ready'`.                                                                                                                                                                                                                                                  |
| `bytes_purge_enqueued_at`  | `TIMESTAMPTZ NULL`                                           | Set when byte purge is queued for a `retained` revision.                                                                                                                                                                                                                                               |
| `created_by_type`          | `TEXT NOT NULL`                                              | `api_key` or `member`.                                                                                                                                                                                                                                                                                 |
| `created_by_id`            | `TEXT NOT NULL`                                              | Creator id for the stored type.                                                                                                                                                                                                                                                                        |
| `created_at`               | `TIMESTAMPTZ NOT NULL`                                       |                                                                                                                                                                                                                                                                                                        |
| `published_at`             | `TIMESTAMPTZ NULL`                                           | Set when `status` becomes `published`.                                                                                                                                                                                                                                                                 |

At most one `draft` row per Artifact (`revisions_one_draft_per_artifact`). Composite unique `(workspace_id, artifact_id, id)` supports tenant-safe foreign keys from `access_links`, `safety_warnings`, and the `parent_revision_id` self-reference (which structurally pins a parent to the same Workspace and Artifact).

### `artifact_files`

| Column                | Type                                                       | Notes                                                                           |
| --------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `workspace_id`        | `UUID NOT NULL REFERENCES workspaces(id)`                  |                                                                                 |
| `artifact_id`         | `TEXT NOT NULL REFERENCES artifacts(id)`                   |                                                                                 |
| `revision_id`         | `TEXT NOT NULL REFERENCES revisions(id) ON DELETE CASCADE` | Revision that owns this file tree; deleting the revision deletes its file rows. |
| `path`                | `TEXT NOT NULL`                                            | Normalized POSIX path.                                                          |
| `size_bytes`          | `BIGINT NOT NULL`                                          |                                                                                 |
| `served_content_type` | `TEXT NOT NULL`                                            | Derived from extension.                                                         |
| `r2_key`              | `TEXT NOT NULL`                                            | Opaque/id-based key.                                                            |
| `sha256`              | `TEXT NULL`                                                | Lowercase hex digest for blob-backed files.                                     |
| `storage_kind`        | `TEXT NOT NULL DEFAULT 'revision'`                         | `revision` or `blob`.                                                           |
| `uploaded_at`         | `TIMESTAMPTZ NOT NULL`                                     |                                                                                 |

Primary key `(artifact_id, revision_id, path)`. Unique normalized paths per revision; multiple revisions can coexist on one Artifact.
For `storage_kind = 'revision'`, `r2_key` points at the legacy
`artifacts/{artifactId}/revisions/{revisionId}/files/{path}` object. For
`storage_kind = 'blob'`, `r2_key` points at a workspace shared blob object under
`workspaces/{workspaceId}/blobs/sha256/{prefix}/{sha256}`.

### `content_blobs`

| Column         | Type                                      | Notes                                                   |
| -------------- | ----------------------------------------- | ------------------------------------------------------- |
| `workspace_id` | `UUID NOT NULL REFERENCES workspaces(id)` | Deduplication scope.                                    |
| `sha256`       | `TEXT NOT NULL`                           | Lowercase hex SHA-256.                                  |
| `size_bytes`   | `BIGINT NOT NULL`                         | Plaintext file size.                                    |
| `r2_key`       | `TEXT NOT NULL UNIQUE`                    | Shared blob object key.                                 |
| `created_at`   | `TIMESTAMPTZ NOT NULL`                    | First verified upload time.                             |
| `updated_at`   | `TIMESTAMPTZ NOT NULL`                    | Last successful upsert for the verified blob reference. |

Primary key `(workspace_id, sha256, size_bytes)`. Identical bytes dedupe only
inside the owning Workspace. v1 does not backfill historical revision-key
objects; rows are created only after a hash-aware upload PUT verifies the
plaintext digest. Jobs-owned blob GC deletes unreferenced `content_blobs` rows
after active Artifact and live pending upload-session checks. In v1 it does not
delete the deterministic shared R2 object key, so a concurrent verified upload
cannot be de-indexed and then have its newly written bytes removed by a delayed
GC delete.

### `safety_warnings`

| Column            | Type                   | Notes                                                      |
| ----------------- | ---------------------- | ---------------------------------------------------------- |
| `id`              | `TEXT PRIMARY KEY`     | `warn_...`.                                                |
| `workspace_id`    | `UUID NOT NULL`        | Tenant id.                                                 |
| `artifact_id`     | `TEXT NOT NULL`        | Parent Artifact.                                           |
| `revision_id`     | `TEXT NOT NULL`        | Parent Revision.                                           |
| `scanner_id`      | `TEXT NOT NULL`        | Scanner namespace, for example `builtin_content`.          |
| `scanner_version` | `TEXT NOT NULL`        | Scanner rule/version string used for idempotent re-scans.  |
| `code`            | `TEXT NOT NULL`        | Stable snake_case warning code.                            |
| `severity`        | `TEXT NOT NULL`        | `info` or `warning`.                                       |
| `scope`           | `TEXT NOT NULL`        | `artifact`, `revision`, or `file`.                         |
| `file_path`       | `TEXT NULL`            | Required for file-scoped warnings; null for broader scope. |
| `message`         | `TEXT NOT NULL`        | Sanitized plain-text message.                              |
| `created_at`      | `TIMESTAMPTZ NOT NULL` | Detection timestamp surfaced as `detected_at`.             |

The async scanner replaces all rows within `(revision_id, scanner_id)` inside a
single `runCommand` transaction. Agent View merges current warnings without
exposing scanner internals.

### `upload_sessions`

| Column                | Type                                      | Notes                                                                                                                                                                            |
| --------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                  | `TEXT PRIMARY KEY`                        | `upl_...`.                                                                                                                                                                       |
| `workspace_id`        | `UUID NOT NULL REFERENCES workspaces(id)` |                                                                                                                                                                                  |
| `artifact_id`         | `TEXT NOT NULL`                           | Reserved before active artifact creation.                                                                                                                                        |
| `revision_id`         | `TEXT NOT NULL`                           | Reserved before active artifact creation.                                                                                                                                        |
| `status`              | `TEXT NOT NULL`                           | `pending`, `finalized`, `expired`, or `failed`.                                                                                                                                  |
| `title`               | `TEXT NOT NULL`                           | Plain text.                                                                                                                                                                      |
| `entrypoint`          | `TEXT NOT NULL`                           | Normalized file path.                                                                                                                                                            |
| `render_mode`         | `TEXT NULL`                               | Explicit client override (`html`, `markdown`, `text`, `image`, `audio`, `video`). Null means infer from the entrypoint extension at finalize. Copied to `revisions.render_mode`. |
| `artifact_expires_at` | `TIMESTAMPTZ NOT NULL`                    | Copied to `artifacts.expires_at` on finalize.                                                                                                                                    |
| `file_count`          | `INTEGER NOT NULL`                        | Expected files.                                                                                                                                                                  |
| `size_bytes`          | `BIGINT NOT NULL`                         | Expected total bytes.                                                                                                                                                            |
| `created_by_type`     | `TEXT NOT NULL`                           | `api_key` or `member`.                                                                                                                                                           |
| `created_by_id`       | `TEXT NOT NULL`                           | Creator id for the stored type.                                                                                                                                                  |
| `expires_at`          | `TIMESTAMPTZ NOT NULL`                    | Upload session TTL, typically 24 hours.                                                                                                                                          |
| `created_at`          | `TIMESTAMPTZ NOT NULL`                    |                                                                                                                                                                                  |
| `finalized_at`        | `TIMESTAMPTZ NULL`                        |                                                                                                                                                                                  |

### `upload_session_files`

| Column                | Type                                           | Notes                                                                                              |
| --------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `workspace_id`        | `UUID NOT NULL REFERENCES workspaces(id)`      |                                                                                                    |
| `upload_session_id`   | `TEXT NOT NULL REFERENCES upload_sessions(id)` |                                                                                                    |
| `path`                | `TEXT NOT NULL`                                | Normalized POSIX path.                                                                             |
| `size_bytes`          | `BIGINT NOT NULL`                              | Expected size.                                                                                     |
| `served_content_type` | `TEXT NOT NULL`                                | Derived before issuing upload URL.                                                                 |
| `r2_key`              | `TEXT NOT NULL`                                | Final artifact object key.                                                                         |
| `sha256`              | `TEXT NULL`                                    | Lowercase hex digest when supplied by client.                                                      |
| `storage_kind`        | `TEXT NOT NULL DEFAULT 'revision'`             | `revision` or `blob`.                                                                              |
| `uploaded_at`         | `TIMESTAMPTZ NULL`                             | Set after successful PUT or existing blob reuse.                                                   |
| `put_url_expires_at`  | `TIMESTAMPTZ NOT NULL`                         | Session-level upper bound for PUT writes. Set to `upload_sessions.expires_at` at session creation. |

Primary key `(upload_session_id, path)`.

`put_url_expires_at` is not the expiry clients should use for signed PUT URLs. When the API returns upload targets, each `files[].expires_at` is the signed PUT-token expiry minted by the upload worker at response time (typically ~15 minutes), which is much shorter than the upload-session TTL (~24 hours). A PUT after the token expiry returns `not_authenticated` even while the session row is still `pending` and `put_url_expires_at` is still in the future.

Hash-aware files use `storage_kind = 'blob'` and share a `r2_key` for identical
`(workspace_id, sha256, size_bytes)` files. Same-session duplicate hashes mark
all matching paths uploaded when the one required PUT succeeds.

### `operation_events`

| Column         | Type                                  | Notes                                                                                                                                                                                                                                                                                                                     |
| -------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`           | `TEXT PRIMARY KEY`                    | `evt_...`.                                                                                                                                                                                                                                                                                                                |
| `workspace_id` | `UUID NULL REFERENCES workspaces(id)` | Null only for system-wide admin events.                                                                                                                                                                                                                                                                                   |
| `actor_type`   | `TEXT NOT NULL`                       | `api_key`, `member`, `admin`, `system`, or `platform`.                                                                                                                                                                                                                                                                    |
| `actor_id`     | `TEXT NULL`                           | Credential id, member/admin identity, or the internal `system`/`platform` actor id (`stripe_webhook`, `billing_reconcile`, an operator identity). Used by operators for provenance; **redacted from tenant-facing audit rows** — see [Audit actor redaction](#audit-actor-redaction). Null only when no actor id applies. |
| `action`       | `TEXT NOT NULL`                       | Stable dotted string (for example `revision.retained`).                                                                                                                                                                                                                                                                   |
| `target_type`  | `TEXT NOT NULL`                       | `workspace`, `api_key`, `upload_session`, `artifact`, `revision`, `cleanup`.                                                                                                                                                                                                                                              |
| `target_id`    | `TEXT NOT NULL`                       |                                                                                                                                                                                                                                                                                                                           |
| `details`      | `JSONB NOT NULL`                      | Redacted details only.                                                                                                                                                                                                                                                                                                    |
| `request_id`   | `TEXT NULL`                           |                                                                                                                                                                                                                                                                                                                           |
| `occurred_at`  | `TIMESTAMPTZ NOT NULL`                |                                                                                                                                                                                                                                                                                                                           |

Operation events are intentionally lightweight but should be shaped so they can evolve into full audit events later.

#### Audit actor redaction

`operation_events` rows are surfaced on two distinct UIs with different trust
boundaries:

- **Tenant `/audit`** (dashboard members): scoped to the member's workspace AND
  filtered to the workspace's own actors — `member`, `api_key`, `admin`
  (`TENANT_AUDIT_ACTOR_TYPES`). Internal `system`/`platform` events (Stripe
  webhooks, reconciliation, retention, operator lockdowns/overrides) are excluded
  by the query (`operationEvents.listWebPage`), so they never enter the tenant
  payload. As defense in depth, the transform also redacts any `system`/`platform`
  actor that reaches it (`system` → `System`, `platform` → `Agent Paste staff`)
  and the change-summary formatters never echo internal provenance such as
  `details.source`.
- **Operator `/admin`** (cross-workspace, `admin` role): `listOperatorPage` applies
  no actor-type allowlist and the transform restores the raw `actor_type:actor_id`
  for full traceability.

The tenant boundary lives in the data layer: the query filter
(`packages/db/src/queries/operation-events.ts` and its local twin) plus the
repository transforms (`toWebAuditRow` redacts; `toWebOperatorEventRow` restores)
and change-summary formatters (`packages/db/src/audit/change-summary.ts`). Do not
move actor filtering or formatting into the React components.

### `idempotency_records`

| Column            | Type                                      | Notes                                  |
| ----------------- | ----------------------------------------- | -------------------------------------- |
| `workspace_id`    | `UUID NOT NULL REFERENCES workspaces(id)` |                                        |
| `actor_type`      | `TEXT NOT NULL`                           | `api_key` or `admin`.                  |
| `actor_id`        | `TEXT NOT NULL`                           |                                        |
| `operation`       | `TEXT NOT NULL`                           | Stable dotted string.                  |
| `idempotency_key` | `TEXT NOT NULL`                           |                                        |
| `status`          | `TEXT NOT NULL`                           | `in_flight`, `completed`, or `failed`. |
| `result_json`     | `JSONB NULL`                              | Completed only, redacted.              |
| `created_at`      | `TIMESTAMPTZ NOT NULL`                    |                                        |
| `completed_at`    | `TIMESTAMPTZ NULL`                        |                                        |

Primary key `(workspace_id, actor_type, actor_id, operation, idempotency_key)`.

## R2 Object Key Layout

Canonical helpers: revision-file and bundle keys in
`packages/db/src/validation.ts`; workspace blob keys in
`packages/storage/src/artifact-bytes-encryption.ts` (`workspaceBlobObjectKeyFor`).
Keys are ID-based; human titles and labels never appear in prefixes. Normalized file paths are
untrusted input and follow the validation rules from
[ADR 0021](../adr/0021-id-based-r2-object-key-layout.md).

| Object kind                                     | Key shape                                                                                     | Notes                                                                                                                 |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Revision file (`storage_kind = 'revision'`)     | `artifacts/{artifactId}/revisions/{revisionId}/files/{path}`                                  | Legacy artifact-scoped prefix used for upload PUT targets, `artifact_files.r2_key`, and byte purge of revision files. |
| Derived bundle                                  | `env/{env}/workspaces/{workspaceId}/artifacts/{artifactId}/revisions/{revisionId}/bundle.zip` | Env-scoped; `{env}` comes from `storageEnvSegment(AGENT_PASTE_ENV)` (`live`, `preview`, or `dev`).                    |
| Workspace shared blob (`storage_kind = 'blob'`) | `workspaces/{workspaceId}/blobs/sha256/{prefix}/{sha256}`                                     | `{prefix}` is the first two hex digits of the lowercase SHA-256 digest. Workspace-scoped deduplication.               |

Env-scoped purge prefixes for jobs and invalidation:

- Artifact scope: `env/{env}/workspaces/{workspaceId}/artifacts/{artifactId}/`
- Revision scope: `env/{env}/workspaces/{workspaceId}/artifacts/{artifactId}/revisions/{revisionId}/`

Deletion and retention enqueue both the legacy revision-file prefix and the
env-scoped artifact prefix so bundles are purged with files. Upload cleanup
purges the session's legacy revision-file keys only (no bundle exists yet). See
[`jobs.md`](./jobs.md#byte-purge).

## KV Denylist

The content Worker has no database binding. Admin deletes and retention cleanup write denylist keys to KV so signed content URLs stop working before their token expiration.

Required key shapes can be implementation-defined, but must cover:

- Artifact id.
- Revision id.

KV values do not contain token material.

## Required Indexes

- `api_keys(public_id) UNIQUE`
- `api_keys(workspace_id) WHERE revoked_at IS NULL`
- `artifacts(workspace_id, created_at DESC)`
- `artifacts(workspace_id, expires_at) WHERE status = 'active'`
- `artifacts(workspace_id, id) UNIQUE`
- `revisions(workspace_id, artifact_id, id) UNIQUE`
- `revisions(artifact_id, revision_number) UNIQUE WHERE revision_number IS NOT NULL`
- `revisions(artifact_id) UNIQUE WHERE status = 'draft'`
- `revisions(artifact_id, created_at DESC)`
- `revisions(workspace_id, artifact_id, parent_revision_id)`
- `artifact_files(artifact_id, revision_id, path) PRIMARY KEY`
- `artifact_files(workspace_id, sha256, size_bytes)`
- `safety_warnings(workspace_id, revision_id)`
- `safety_warnings(workspace_id, revision_id, scanner_id)`
- `upload_sessions(workspace_id, expires_at) WHERE status = 'pending'`
- `upload_session_files(upload_session_id, path) UNIQUE`
- `upload_session_files(workspace_id, sha256, size_bytes)`
- `content_blobs(workspace_id, sha256, size_bytes) PRIMARY KEY`
- `content_blobs(r2_key) UNIQUE`
- `operation_events(workspace_id, occurred_at DESC)`
- `idempotency_records(created_at)` for garbage collection
