# Data Model Spec

This is the schema implementation target for the MVP. Drizzle definitions should live in `packages/db`, but table shape and invariants are specified here first.

## Global Rules

- Tenant tables include `workspace_id UUID NOT NULL`.
- Tenant tables have RLS enabled in the migration that creates them.
- Tenant RLS predicate: `workspace_id = current_setting('app.workspace_id', true)::uuid`.
- Worker application role is `app_role NOBYPASSRLS`.
- Migrations and explicit platform reads use `platform_admin BYPASSRLS`.
- Timestamps are `TIMESTAMPTZ`.
- Public IDs use the formats in [`contracts.md`](./contracts.md).
- Secrets are never stored plaintext.

## Tables

### `workspaces`

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID PRIMARY KEY` | RLS tenant id. |
| `name` | `TEXT NOT NULL` | Defaults from the first member's display name or email prefix. |
| `created_at` | `TIMESTAMPTZ NOT NULL` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL` | |
| `platform_lockdown_at` | `TIMESTAMPTZ NULL` | Effective workspace lockdown is also represented in `platform_lockdowns`. |

### `workspace_members`

| Column | Type | Notes |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | `wm_...`. |
| `workspace_id` | `UUID NOT NULL REFERENCES workspaces(id)` | RLS. |
| `auth0_sub` | `TEXT NOT NULL UNIQUE` | Immutable Auth0 join key. |
| `email` | `TEXT NOT NULL` | Refreshed on login. |
| `email_verified` | `BOOLEAN NOT NULL` | Must be true for sign-in. |
| `display_name` | `TEXT NOT NULL` | |
| `created_at` | `TIMESTAMPTZ NOT NULL` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL` | |

MVP invariant: one member per workspace.

### `usage_policies`

| Column | Type | Notes |
|---|---|---|
| `workspace_id` | `UUID PRIMARY KEY REFERENCES workspaces(id)` | RLS. |
| `file_size_cap_bytes` | `BIGINT NOT NULL` | Default 25 MB. |
| `file_count_cap` | `INTEGER NOT NULL` | Default 500. |
| `revision_size_cap_bytes` | `BIGINT NOT NULL` | Default 100 MB. |
| `bundle_size_cap_bytes` | `BIGINT NOT NULL` | Default 100 MB. |
| `actor_rate_limit_per_minute` | `INTEGER NOT NULL` | Default 60. |
| `workspace_burst_cap_per_minute` | `INTEGER NOT NULL` | Default 300. |
| `access_link_creation_enabled` | `BOOLEAN NOT NULL` | Default true. |
| `bundles_enabled` | `BOOLEAN NOT NULL` | Default true. |
| `auto_deletion_days` | `INTEGER NOT NULL` | Default 30, max 90, min 1. |
| `revision_retention_days` | `INTEGER NULL` | Null means keep all non-current revisions. |
| `created_at` | `TIMESTAMPTZ NOT NULL` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL` | |

`revision_retention_days` fills the Retention gap: the MVP supports Retention, but the default policy keeps all revisions unless this value is set later.

### `api_keys`

| Column | Type | Notes |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | `key_...`. |
| `workspace_id` | `UUID NOT NULL REFERENCES workspaces(id)` | RLS. |
| `public_id` | `TEXT NOT NULL UNIQUE` | 16-char lookup segment. |
| `name` | `TEXT NOT NULL` | Human assigned. |
| `secret_hmac` | `BYTEA NOT NULL` | HMAC-SHA-256 of secret segment with pepper. |
| `pepper_kid` | `SMALLINT NOT NULL` | Current pepper generation. |
| `scopes` | `TEXT[] NOT NULL` | Only `write`, `read`, `share`. |
| `expires_at` | `TIMESTAMPTZ NULL` | |
| `revoked_at` | `TIMESTAMPTZ NULL` | |
| `last_used_at` | `TIMESTAMPTZ NULL` | |
| `created_by` | `TEXT NOT NULL` | Workspace member id. |
| `created_at` | `TIMESTAMPTZ NOT NULL` | |

Index `public_id`, and partial index active keys by `(workspace_id) WHERE revoked_at IS NULL`.

### `artifacts`

| Column | Type | Notes |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | `art_...`. |
| `workspace_id` | `UUID NOT NULL REFERENCES workspaces(id)` | RLS. |
| `status` | `TEXT NOT NULL` | `unpublished`, `active`, `deleted`. |
| `published_revision_id` | `TEXT NULL` | Current Published Revision. |
| `title` | `TEXT NOT NULL` | Display Metadata. |
| `description` | `TEXT NULL` | Display Metadata. |
| `creator_type` | `TEXT NOT NULL` | `member` or `api_key`. |
| `creator_id` | `TEXT NOT NULL` | Historical attribution. |
| `pinned_at` | `TIMESTAMPTZ NULL` | Dashboard-only. |
| `access_link_lockdown_at` | `TIMESTAMPTZ NULL` | Source of truth for Access Link Lockdown. |
| `access_link_lockdown_by` | `TEXT NULL` | Actor id. |
| `last_published_at` | `TIMESTAMPTZ NULL` | Drives Auto Deletion. |
| `deleted_at` | `TIMESTAMPTZ NULL` | Access state. |
| `bytes_purge_enqueued_at` | `TIMESTAMPTZ NULL` | Crash recovery. |
| `created_at` | `TIMESTAMPTZ NOT NULL` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL` | |

The `access_links` table does not store per-link lockdown state. Effective Access Link Lockdown comes from joining `artifacts` and `platform_lockdowns`.

### `revisions`

| Column | Type | Notes |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | `rev_...`. |
| `workspace_id` | `UUID NOT NULL REFERENCES workspaces(id)` | RLS. |
| `artifact_id` | `TEXT NOT NULL REFERENCES artifacts(id)` | |
| `revision_number` | `INTEGER NOT NULL` | Unique per artifact. |
| `status` | `TEXT NOT NULL` | `draft`, `published`, `retained`. |
| `entrypoint` | `TEXT NOT NULL` | Normalized file path. |
| `render_mode` | `TEXT NOT NULL` | MVP Render Mode enum. |
| `file_count` | `INTEGER NOT NULL` | |
| `size_bytes` | `BIGINT NOT NULL` | |
| `bundle_status` | `TEXT NOT NULL` | `disabled`, `pending`, `ready`, `failed`. |
| `bundle_size_bytes` | `BIGINT NULL` | Ready only. |
| `bundle_status_updated_at` | `TIMESTAMPTZ NOT NULL` | |
| `published_at` | `TIMESTAMPTZ NULL` | |
| `retained_at` | `TIMESTAMPTZ NULL` | |
| `bytes_purge_enqueued_at` | `TIMESTAMPTZ NULL` | Crash recovery. |
| `created_by_type` | `TEXT NOT NULL` | |
| `created_by_id` | `TEXT NOT NULL` | |
| `created_at` | `TIMESTAMPTZ NOT NULL` | |

Unique `(workspace_id, artifact_id, revision_number)`. At most one `draft` revision per artifact.

### `revision_files`

| Column | Type | Notes |
|---|---|---|
| `workspace_id` | `UUID NOT NULL` | RLS. |
| `revision_id` | `TEXT NOT NULL REFERENCES revisions(id)` | |
| `artifact_id` | `TEXT NOT NULL REFERENCES artifacts(id)` | Denormalized for RLS joins and queue work. |
| `path` | `TEXT NOT NULL` | Normalized POSIX path. |
| `size_bytes` | `BIGINT NOT NULL` | |
| `sha256` | `TEXT NOT NULL` | Lowercase hex. |
| `served_content_type` | `TEXT NOT NULL` | Derived at finalize. |
| `r2_key` | `TEXT NOT NULL` | Deterministic key from ADR 0021. |
| `uploaded_at` | `TIMESTAMPTZ NOT NULL` | |

Primary key `(revision_id, path)`. Unique normalized paths per Revision.

### `upload_sessions`

| Column | Type | Notes |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | `upl_...`. |
| `workspace_id` | `UUID NOT NULL` | RLS. |
| `artifact_id` | `TEXT NOT NULL` | Reserved before `artifacts` row exists. |
| `revision_id` | `TEXT NOT NULL` | Reserved before `revisions` row exists. |
| `existing_artifact_id` | `TEXT NULL` | Null for new Artifact. |
| `status` | `TEXT NOT NULL` | `pending`, `finalized`, `abandoned`, `expired`, `failed_terminal`. |
| `expires_at` | `TIMESTAMPTZ NOT NULL` | 24 hours. |
| `created_by_type` | `TEXT NOT NULL` | |
| `created_by_id` | `TEXT NOT NULL` | |
| `created_at` | `TIMESTAMPTZ NOT NULL` | |
| `finalized_at` | `TIMESTAMPTZ NULL` | |

### `upload_session_files`

| Column | Type | Notes |
|---|---|---|
| `workspace_id` | `UUID NOT NULL` | RLS. |
| `upload_session_id` | `TEXT NOT NULL REFERENCES upload_sessions(id)` | |
| `path` | `TEXT NOT NULL` | Normalized path. |
| `size_bytes` | `BIGINT NOT NULL` | Expected size. |
| `sha256` | `TEXT NULL` | Optional caller-provided hash. |
| `r2_key` | `TEXT NOT NULL` | Final revision file key. |
| `put_url_expires_at` | `TIMESTAMPTZ NOT NULL` | Expiration for the signed upload-worker PUT URL. |

Primary key `(upload_session_id, path)`.

### `access_links`

| Column | Type | Notes |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | `al_...`. |
| `workspace_id` | `UUID NOT NULL` | RLS. |
| `artifact_id` | `TEXT NOT NULL REFERENCES artifacts(id)` | |
| `revision_id` | `TEXT NULL REFERENCES revisions(id)` | Null for Share Link. |
| `public_id` | `TEXT NOT NULL UNIQUE` | URL path segment. |
| `type` | `TEXT NOT NULL` | `share` or `revision`. |
| `scopes_bitmask` | `INTEGER NOT NULL` | Signed into URL blob. |
| `expires_at` | `TIMESTAMPTZ NULL` | Durable row expiration. |
| `revoked_at` | `TIMESTAMPTZ NULL` | |
| `created_by_type` | `TEXT NOT NULL` | |
| `created_by_id` | `TEXT NOT NULL` | |
| `created_at` | `TIMESTAMPTZ NOT NULL` | |

No bearer secret, ciphertext, wrapping key, or HMAC is stored.

### `safety_warnings`

| Column | Type | Notes |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | Implementation may use ULID. |
| `workspace_id` | `UUID NOT NULL` | RLS. |
| `artifact_id` | `TEXT NOT NULL` | |
| `revision_id` | `TEXT NOT NULL REFERENCES revisions(id)` | |
| `scanner_id` | `TEXT NOT NULL` | `publish_sync`, `stub_v1`, future scanners. |
| `scanner_version` | `TEXT NOT NULL` | |
| `code` | `TEXT NOT NULL` | Stable snake_case. |
| `severity` | `TEXT NOT NULL` | `info` or `warning`. |
| `scope` | `TEXT NOT NULL` | `artifact`, `revision`, or `file`. |
| `file_path` | `TEXT NULL` | Normalized path when file-scoped. |
| `message` | `TEXT NOT NULL` | Sanitized plain text. |
| `created_at` | `TIMESTAMPTZ NOT NULL` | |

Index `(workspace_id, revision_id)`.

### `audit_events`

| Column | Type | Notes |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | `aud_...`. |
| `workspace_id` | `UUID NOT NULL` | RLS. |
| `actor_type` | `TEXT NOT NULL` | `member`, `api_key`, `system`, `platform`. |
| `actor_id` | `TEXT NOT NULL` | |
| `action` | `TEXT NOT NULL` | Stable dotted string. |
| `target_type` | `TEXT NOT NULL` | |
| `target_id` | `TEXT NOT NULL` | |
| `change_summary` | `JSONB NOT NULL` | Redacted. |
| `request_id` | `TEXT NULL` | |
| `ip_hash` | `TEXT NULL` | Optional. |
| `user_agent` | `TEXT NULL` | Redacted/truncated. |
| `occurred_at` | `TIMESTAMPTZ NOT NULL` | |

Audit Retention removes rows older than 180 days.

### `idempotency_records`

| Column | Type | Notes |
|---|---|---|
| `workspace_id` | `UUID NOT NULL` | RLS. |
| `actor_id` | `TEXT NOT NULL` | |
| `actor_type` | `TEXT NOT NULL` | |
| `operation` | `TEXT NOT NULL` | Stable dotted string. |
| `idempotency_key` | `TEXT NOT NULL` | |
| `status` | `TEXT NOT NULL` | `in_flight`, `completed`. |
| `result_json` | `JSONB NULL` | Completed only. |
| `correlation_id` | `TEXT NULL` | |
| `trace_id` | `TEXT NULL` | |
| `created_at` | `TIMESTAMPTZ NOT NULL` | |
| `completed_at` | `TIMESTAMPTZ NULL` | |

Primary key `(workspace_id, actor_id, operation, idempotency_key)`. Completed rows expire after 24 hours.

### `platform_lockdowns`

| Column | Type | Notes |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | Implementation may use ULID. |
| `scope` | `TEXT NOT NULL` | `workspace` or `artifact`. |
| `target_id` | `TEXT NOT NULL` | Workspace UUID text or ArtifactId. |
| `reason_code` | `TEXT NOT NULL` | Operator supplied stable code. |
| `set_at` | `TIMESTAMPTZ NOT NULL` | |
| `set_by` | `TEXT NOT NULL` | Operator identity. |
| `lifted_at` | `TIMESTAMPTZ NULL` | |
| `lifted_by` | `TEXT NULL` | |

One effective active row per `(scope, target_id)`.

## Required Indexes

- `workspace_members(auth0_sub) UNIQUE`
- `api_keys(public_id) UNIQUE`
- `artifacts(workspace_id, created_at DESC)`
- `artifacts(workspace_id, last_published_at)` for Auto Deletion
- `revisions(workspace_id, artifact_id, revision_number DESC) UNIQUE`
- `revisions(workspace_id, status, published_at)` for Retention
- `revision_files(revision_id, path) UNIQUE`
- `upload_sessions(workspace_id, expires_at)` for Upload Cleanup
- `access_links(public_id) UNIQUE`
- `access_links(workspace_id, artifact_id, created_at DESC)`
- `safety_warnings(workspace_id, revision_id)`
- `audit_events(workspace_id, occurred_at DESC)`
- `platform_lockdowns(scope, target_id) WHERE lifted_at IS NULL`
