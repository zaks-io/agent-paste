# Jobs Spec

This spec describes the `jobs` Worker cron discovery and Cloudflare Queue consumers. Lifecycle byte purge and retention sweeps are authoritative here; the API Worker no longer runs scheduled cleanup.

The `jobs` Worker owns cron discovery and Cloudflare Queue consumers. It imports `packages/contracts` for payload types when those payloads are promoted into code.

## Queues

| Queue             | Consumer | Batch | DLQ                   | DLQ Consumer | Purpose                                                          |
| ----------------- | -------- | ----: | --------------------- | ------------ | ---------------------------------------------------------------- |
| `byte-purge`      | `jobs`   |    50 | `byte-purge-dlq`      | none         | Delete R2 prefixes after Deletion, Retention, or Upload Cleanup. |
| `safety-scan`     | `jobs`   |     1 | `safety-scan-dlq`     | none         | Run warning scanners and replace warning metadata.               |
| `bundle-generate` | `jobs`   |     1 | `bundle-generate-dlq` | yes          | Generate revision bundle zip.                                    |

Only `bundle-generate-dlq` has a consumer because terminal bundle failure must update public product state to `failed`.

## Cron Triggers

| Cron           |          Cadence |             Sweep Cap | Work                                                                                                                                         |
| -------------- | ---------------: | --------------------: | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Upload Cleanup | every 15 minutes |                   200 | Expire stale Upload Sessions and enqueue orphan-byte purge.                                                                                  |
| Auto Deletion  |           hourly |                   200 | Expire unpinned published Artifacts past `auto_deletion_days`, then write denylist and enqueue byte purge.                                   |
| Purge Recovery |           hourly |                   200 | Rediscover deleted or expired Artifacts whose current Revision lacks `bytes_purge_enqueued_at`; write denylist and enqueue byte purge.       |
| Retention      |           hourly |                   500 | Mark non-current Revisions retained when `revision_retention_days` is set.                                                                   |
| Maintenance GC |           hourly | 5000 idempotency rows | Delete old idempotency rows; archive audit events past Audit Retention to R2 (`audit/` NDJSON under `ARTIFACTS`), then delete from Postgres. |

Retention is implemented from day one, but the default `revision_retention_days` is null, so it keeps all Revisions unless a policy value is later set.

## Message Schemas

### `bundle-generate`

```json
{
  "type": "bundle.generate.v1",
  "workspace_id": "00000000-0000-0000-0000-000000000000",
  "artifact_id": "art_...",
  "revision_id": "rev_...",
  "requested_at": "2026-05-20T00:00:00.000Z",
  "reason": "publish"
}
```

Handler behavior:

- Read Revision and parent Artifact state.
- Return idempotently if Revision is retained, Artifact is deleted, or bundle status is `ready` or `disabled`.
- Build deterministic R2 key from ADR 0021.
- Enforce Bundle Size Cap during generation.
- On success, set `bundle_status='ready'`, `bundle_size_bytes`, and `bundle_status_updated_at`.
- On permanent generation error after queue retries, DLQ consumer sets `bundle_status='failed'`.
- Bundle state changes do not create Audit Events.

### `safety-scan`

This queue is product warning metadata and abuse-response support. It is not
malware certification, and warning results are not part of the content isolation
trust boundary.

```json
{
  "type": "safety.scan.v1",
  "workspace_id": "00000000-0000-0000-0000-000000000000",
  "artifact_id": "art_...",
  "revision_id": "rev_...",
  "scanner_id": "builtin_content",
  "scanner_version": "1",
  "requested_at": "2026-05-20T00:00:00.000Z"
}
```

Handler behavior:

- Return idempotently if Revision is retained or Artifact is deleted.
- Resolve `scanner_id` and run warning rules over `revision_files`.
  `builtin_content` uses built-in text warning rules. `ephemeral_tier` adds
  dormant-script warnings and optional Llama Guard text moderation.
- Replace all warnings in `(revision_id, scanner_id)` inside `runCommand`.
- Include `scanner_version` in the idempotency key so rule changes can re-scan
  the same Revision.
- Create an Audit Event with added/removed/unchanged counts when warnings
  change.
- For `ephemeral_tier`, submit the public Agent View URL to Cloudflare URL
  Scanner when configured. A malicious verdict writes artifact-scoped
  **Platform Lockdown**; scanner failures fail quiet.
- DLQ has no consumer; alerts drive operator triage.

### `byte-purge`

```json
{
  "type": "byte.purge.v1",
  "workspace_id": "00000000-0000-0000-0000-000000000000",
  "artifact_id": "art_...",
  "revision_id": "rev_...",
  "upload_session_id": null,
  "prefixes": ["env/live/workspaces/..."],
  "reason": "deletion"
}
```

`reason` is one of `deletion`, `retention`, or `upload_cleanup`.

Handler behavior:

- Delete all listed prefixes idempotently.
- Do not create Audit Events for byte deletion itself.
- On failure, leave the relevant `bytes_purge_enqueued_at` marker in place for operator visibility.

## Post-Commit Sequencing

Deletion, Retention, Access Link Lockdown, Platform Lockdown, and Access Link revocation follow this order:

1. Commit the Postgres state change and Audit Event through `runCommand`.
2. Write the KV denylist entry with retries.
3. Enqueue byte purge when bytes must be removed.

If KV denylist writes fail, do not enqueue purge. The next cron rediscovery is the recovery path.

## System Actors

| Work            | `actor_type` | `actor_id`        |
| --------------- | ------------ | ----------------- |
| Auto Deletion   | `system`     | `auto_deletion`   |
| Retention       | `system`     | `retention`       |
| Upload Cleanup  | `system`     | `upload_cleanup`  |
| Safety Scan     | `system`     | `safety_scan`     |
| Bundle Generate | `system`     | `bundle_generate` |

## Alerts

Initial alerts:

- Any DLQ depth above zero for 5 minutes.
- Cron sweep `cap_hit=true` for 3 consecutive runs.
- Bundle generation failure rate above 5 percent over 15 minutes.
- Byte purge failures above zero over 15 minutes.
- Database unavailable from `jobs`.
