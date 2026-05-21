# Data Model Spec

This is the schema target for the CLI-first MVP. Drizzle definitions should live in `packages/db`. The database is Postgres reached from Workers through Cloudflare Hyperdrive.

## Global Rules

- Tenant-owned tables include `workspace_id UUID NOT NULL`.
- Tenant-owned tables should be compatible with Postgres RLS from the first migration.
- Timestamps are `TIMESTAMPTZ`.
- Public IDs use the formats in [`contracts.md`](./contracts.md).
- Secrets are never stored plaintext.
- Signed content tokens and full signed URLs are never stored in normal metadata or operation-event details.
- The MVP has one revision per artifact, but keeps `revision_id` so multi-revision artifacts can be added later without renaming the concept.

## Tables

### `workspaces`

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID PRIMARY KEY` | Tenant id. |
| `name` | `TEXT NOT NULL` | Operator supplied or inferred from email. |
| `contact_email` | `TEXT NULL` | Operator-supplied MVP contact. Public OAuth membership is future work. |
| `created_at` | `TIMESTAMPTZ NOT NULL` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL` | |

### `api_keys`

| Column | Type | Notes |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | `key_...`. |
| `workspace_id` | `UUID NOT NULL REFERENCES workspaces(id)` | |
| `public_id` | `TEXT NOT NULL UNIQUE` | Lookup segment from the bearer token. |
| `name` | `TEXT NOT NULL` | Operator assigned. |
| `secret_hmac` | `BYTEA NOT NULL` | HMAC-SHA-256 of secret segment with pepper. |
| `pepper_kid` | `SMALLINT NOT NULL` | Current pepper generation. |
| `revoked_at` | `TIMESTAMPTZ NULL` | |
| `last_used_at` | `TIMESTAMPTZ NULL` | |
| `created_at` | `TIMESTAMPTZ NOT NULL` | |

MVP API keys grant the publish/read capability needed by the public CLI. Granular scopes are future work.

### `artifacts`

| Column | Type | Notes |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | `art_...`. |
| `workspace_id` | `UUID NOT NULL REFERENCES workspaces(id)` | |
| `revision_id` | `TEXT NOT NULL UNIQUE` | `rev_...`; one revision per artifact in MVP. |
| `status` | `TEXT NOT NULL` | `active`, `deleted`, or `expired`. |
| `title` | `TEXT NOT NULL` | Plain text. |
| `entrypoint` | `TEXT NOT NULL` | Normalized file path. |
| `file_count` | `INTEGER NOT NULL` | |
| `size_bytes` | `BIGINT NOT NULL` | Total uploaded bytes. |
| `expires_at` | `TIMESTAMPTZ NOT NULL` | Required. |
| `created_by_api_key_id` | `TEXT NOT NULL REFERENCES api_keys(id)` | Historical attribution. |
| `deleted_at` | `TIMESTAMPTZ NULL` | Set for `deleted` and `expired`. |
| `delete_reason` | `TEXT NULL` | `admin_delete`, `expired`, or future reason. |
| `created_at` | `TIMESTAMPTZ NOT NULL` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL` | |

No artifact can be created without `expires_at`.

### `artifact_files`

| Column | Type | Notes |
|---|---|---|
| `workspace_id` | `UUID NOT NULL REFERENCES workspaces(id)` | |
| `artifact_id` | `TEXT NOT NULL REFERENCES artifacts(id)` | |
| `revision_id` | `TEXT NOT NULL` | Denormalized from `artifacts.revision_id`. |
| `path` | `TEXT NOT NULL` | Normalized POSIX path. |
| `size_bytes` | `BIGINT NOT NULL` | |
| `served_content_type` | `TEXT NOT NULL` | Derived from extension. |
| `r2_key` | `TEXT NOT NULL` | Opaque/id-based key. |
| `uploaded_at` | `TIMESTAMPTZ NOT NULL` | |

Primary key `(artifact_id, path)`. Unique normalized paths per artifact.

### `upload_sessions`

| Column | Type | Notes |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | `upl_...`. |
| `workspace_id` | `UUID NOT NULL REFERENCES workspaces(id)` | |
| `artifact_id` | `TEXT NOT NULL` | Reserved before active artifact creation. |
| `revision_id` | `TEXT NOT NULL` | Reserved before active artifact creation. |
| `status` | `TEXT NOT NULL` | `pending`, `finalized`, `expired`, or `failed`. |
| `title` | `TEXT NOT NULL` | Plain text. |
| `entrypoint` | `TEXT NOT NULL` | Normalized file path. |
| `artifact_expires_at` | `TIMESTAMPTZ NOT NULL` | Copied to `artifacts.expires_at` on finalize. |
| `file_count` | `INTEGER NOT NULL` | Expected files. |
| `size_bytes` | `BIGINT NOT NULL` | Expected total bytes. |
| `created_by_api_key_id` | `TEXT NOT NULL REFERENCES api_keys(id)` | |
| `expires_at` | `TIMESTAMPTZ NOT NULL` | Upload session TTL, typically 24 hours. |
| `created_at` | `TIMESTAMPTZ NOT NULL` | |
| `finalized_at` | `TIMESTAMPTZ NULL` | |

### `upload_session_files`

| Column | Type | Notes |
|---|---|---|
| `workspace_id` | `UUID NOT NULL REFERENCES workspaces(id)` | |
| `upload_session_id` | `TEXT NOT NULL REFERENCES upload_sessions(id)` | |
| `path` | `TEXT NOT NULL` | Normalized POSIX path. |
| `size_bytes` | `BIGINT NOT NULL` | Expected size. |
| `served_content_type` | `TEXT NOT NULL` | Derived before issuing upload URL. |
| `r2_key` | `TEXT NOT NULL` | Final artifact object key. |
| `uploaded_at` | `TIMESTAMPTZ NULL` | Set after successful PUT. |
| `put_url_expires_at` | `TIMESTAMPTZ NOT NULL` | Expiration for signed upload-worker PUT URL. |

Primary key `(upload_session_id, path)`.

### `operation_events`

| Column | Type | Notes |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | `evt_...`. |
| `workspace_id` | `UUID NULL REFERENCES workspaces(id)` | Null only for system-wide admin events. |
| `actor_type` | `TEXT NOT NULL` | `api_key`, `admin`, or `system`. |
| `actor_id` | `TEXT NULL` | API key id, admin identity, or null for system. |
| `action` | `TEXT NOT NULL` | Stable dotted string. |
| `target_type` | `TEXT NOT NULL` | `workspace`, `api_key`, `upload_session`, `artifact`, `cleanup`. |
| `target_id` | `TEXT NOT NULL` | |
| `details` | `JSONB NOT NULL` | Redacted details only. |
| `request_id` | `TEXT NULL` | |
| `occurred_at` | `TIMESTAMPTZ NOT NULL` | |

Operation events are intentionally lightweight but should be shaped so they can evolve into full audit events later.

### `idempotency_records`

| Column | Type | Notes |
|---|---|---|
| `workspace_id` | `UUID NOT NULL REFERENCES workspaces(id)` | |
| `actor_type` | `TEXT NOT NULL` | `api_key` or `admin`. |
| `actor_id` | `TEXT NOT NULL` | |
| `operation` | `TEXT NOT NULL` | Stable dotted string. |
| `idempotency_key` | `TEXT NOT NULL` | |
| `status` | `TEXT NOT NULL` | `in_flight`, `completed`, or `failed`. |
| `result_json` | `JSONB NULL` | Completed only, redacted. |
| `created_at` | `TIMESTAMPTZ NOT NULL` | |
| `completed_at` | `TIMESTAMPTZ NULL` | |

Primary key `(workspace_id, actor_type, actor_id, operation, idempotency_key)`.

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
- `artifacts(revision_id) UNIQUE`
- `artifact_files(artifact_id, path) UNIQUE`
- `upload_sessions(workspace_id, expires_at) WHERE status = 'pending'`
- `upload_session_files(upload_session_id, path) UNIQUE`
- `operation_events(workspace_id, occurred_at DESC)`
- `idempotency_records(created_at)` for garbage collection
