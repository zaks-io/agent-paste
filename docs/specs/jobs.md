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

Producers may add optional `trace_context` transport metadata after validating
the business message. It carries a valid `sentry-trace` header and bounded
Sentry sampling/release `baggage`, excluding transaction names and arbitrary
application baggage. Consumers isolate each message's trace, preserve its
context across retry and DLQ delivery, and mark failed processing spans as errors
without changing ack/retry semantics. Old messages and malformed optional
telemetry start independent traces. This metadata is not business authority and
does not change the versioned job payload schemas.

## Cron Triggers

| Cron              |           Cadence |             Sweep Cap | Work                                                                                                                                                     |
| ----------------- | ----------------: | --------------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upload Cleanup    |  every 15 minutes |                   200 | Expire stale Upload Sessions and enqueue orphan-byte purge. Also runs first in the hourly sweep so environments without the 15-minute cron stay covered. |
| Auto Deletion     |            hourly |                   200 | Expire unpinned published Artifacts past `auto_deletion_days`, then write denylist and enqueue byte purge.                                               |
| Lockdown Recovery |            hourly |          200 per page | Rewrite every effective persisted Platform Lockdown as a non-expiring denylist marker; no byte purge.                                                    |
| Purge Recovery    |            hourly |                   200 | Rediscover deleted or expired Artifacts whose current Revision lacks `bytes_purge_enqueued_at`; write denylist and enqueue byte purge.                   |
| Retention         |            hourly |                   500 | Mark non-current Revisions retained when `revision_retention_days` is set.                                                                               |
| Content Blob GC   |            hourly |                   500 | Mark unreferenced blobs after a 24-hour age floor, delete eligible R2 bytes, then remove rows. Historical bytes remain.                                  |
| Maintenance GC    |            hourly | 5000 idempotency rows | Delete old idempotency rows; archive audit events past Audit Retention to R2 (`audit/` NDJSON under `ARTIFACTS`), then delete from Postgres.             |
| Billing Reconcile | daily (06:00 UTC) |                   500 | Reconcile Stripe subscription state into workspace plans (ADR 0074). No-op unless `BILLING_ENABLED` is `true` and Stripe secrets are present.            |

Upload Cleanup expires both `pending` and `ready` sessions. It wins the guarded
state transition before enqueueing any legacy Revision-prefix purge. Workspace
blobs and chunks are never included in prefix purge messages; shared committed
bytes remain reusable and only blob GC can reclaim them.

Content Blob GC uses the shared database collector. References include live
Artifact Revision files and maps, unexpired pending/ready session files and
chunks, and physical chunks belonging to a live logical blob. Reuse touches
rows under the same row lock as GC; deleting tombstones cannot be reused.
Sweeps retry tombstones first, mark live unreferenced rows older than 24 hours,
delete eligible single-format R2 objects in batches of at most 1,000, and then
remove the rows. Logical parent deletion cascades to its chunk list; unreferenced
physical chunks become collectible on a later sweep. Failed R2 deletion leaves
tombstones for retry. Missing R2 access leaves eligible tombstones in place.
Rows predating migration 0033 have `r2_cleanup_eligible=false` and receive row-only
GC, preserving historical bytes. Unreferenced bytes continue to count toward
storage usage until their rows are removed, up to the age floor plus one sweep.

Retention is implemented from day one, but the default `revision_retention_days` is null, so it keeps all Revisions unless a policy value is later set.

The table is the production schedule. Each enabled, database-backed sweep opens a Postgres connection, and each connection restarts Neon's 5-minute scale-to-zero timer, so non-production environments run fewer sweeps: the standing preview `jobs` Worker runs the hourly and daily crons only (`apps/jobs/wrangler.jsonc` `env.preview.triggers`), and PR preview `jobs` Workers run the hourly cron only (`scripts/deploy-pr-preview.mjs`). Because Upload Cleanup also runs inside the hourly sweep, those environments expire stale Upload Sessions hourly instead of every 15 minutes.

## Kill Switch

`JOBS_ENABLED=false` skips cron sweeps and makes queue consumers retry (never
ack) messages, so Cloudflare Queues redelivers them when jobs are re-enabled.
Acking while disabled would lose work permanently: byte-purge enqueue stamps
`bytes_purge_enqueued_at` at send time, so an acked-and-dropped message is
invisible to Purge Recovery. A disabled window longer than the retry budget
exhausts messages into the DLQ; operator triage drains it after re-enable.

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
- Build deterministic R2 key per the
  [R2 object key layout](./data-model.md#r2-object-key-layout).
- Deflate entries with text-like served types (HTML, CSS, JavaScript, JSON,
  SVG, Markdown, plain text); store every other entry as-is.
- Before reading any file bytes, disable bundle generation when the Revision's
  plaintext size exceeds the smaller of 16 MiB and the Bundle Size Cap. The
  16 MiB input bound reserves memory for buffered ZIP output and encryption
  copies. Set `bundle_status='disabled'` and acknowledge the job without R2 reads.
- Enforce Bundle Size Cap against the finished zip size during generation.
- On success, set `bundle_status='ready'`, `bundle_size_bytes`, and `bundle_status_updated_at`.
- On permanent generation error after queue retries, DLQ consumer sets `bundle_status='failed'`.
- Bundle state changes do not create Audit Events.

Disabled bundles report `revision_too_large` when any file is chunked or the
Revision exceeds 16 MiB of plaintext input. Other disabled bundles report
`disabled_by_policy`. Repository publish and Agent View metadata use the same
reason mapping.

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
- Resolve `scanner_id` and run warning rules over `artifact_files`.
  `builtin_content` uses built-in text warning rules. `ephemeral_tier` adds
  dormant-script warnings and optional Llama Guard text moderation.
- Skip `chunked-v1` files without fetching their virtual keys and log
  `safety_scan.file_skipped` with reason `chunked_file`. Single files keep the
  existing encrypted read and scanner workflow.
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
  "prefixes": [
    "artifacts/art_.../",
    "env/live/workspaces/00000000-0000-0000-0000-000000000000/artifacts/art_.../"
  ],
  "reason": "deletion"
}
```

`reason` is one of `deletion`, `retention`, or `upload_cleanup`.

Every prefix must be scoped to the message's own Artifact, in one of two
shapes: `artifacts/{artifact_id}/...` (Revision file keys) or
`env/{env}/workspaces/{workspace_id}/artifacts/{artifact_id}/...` (derived
bundle keys). Current key layout is in
[`data-model.md`](./data-model.md#r2-object-key-layout). For env-scoped prefixes, `{env}` must match the
consumer Worker's `AGENT_PASTE_ENV` via `storageEnvSegment`. Deletion and
Retention producers enqueue both shapes so bundle zips are purged with the
files; Upload Cleanup purges the session's file keys only (no bundle exists
yet). The consumer rejects any prefix outside the message's artifact scope or
with a foreign env segment.

Handler behavior:

- Delete all listed prefixes idempotently.
- Do not create Audit Events for byte deletion itself.
- On failure, leave the relevant `bytes_purge_enqueued_at` marker in place for operator visibility.

## Post-Commit Sequencing

Deletion and Platform Lockdown follow this order. Dormant legacy Access Link
operations retain the same sequencing inside their repository workflows, but
no current route invokes them.

1. Commit the Postgres state change and Audit Event through `runCommand`.
2. Write the KV denylist entry with retries.
3. Enqueue byte purge when bytes must be removed.

If KV denylist writes fail, do not enqueue purge. The next cron rediscovery is the recovery path.

Lockdown Recovery runs on the hourly discovery path independently of the byte
purge queue. It scans all effective `platform_lockdowns` in ID-ordered pages of
200, including preexisting records whose markers have expired or still have a
TTL. Each marker is rewritten without KV expiration. There is no first-page
only sweep cap because recovered lockdowns remain effective and would otherwise
starve later pages. Recovery rechecks `lifted_at is null` under a row lock held
through the KV write, serializing with lift so it cannot restore a marker after
that lift removes it. Failed writes leave the DB lockdown intact, log the
failure, and retry on the next hourly sweep. Recovery never removes markers,
changes lockdown state, or enqueues byte deletion.

New Artifact deletion and Revision retention markers also have no expiration,
so a failed or delayed purge cannot reopen a non-expiring capability. Existing
lift retention guards continue to protect shared Artifact denylist keys.

**Retention is the exception**: it runs the denylist write and purge enqueue
_before_ committing the `retained` status flip, and skips the commit when
either side effect fails. Retention's rediscovery selects `published`
revisions, so the revision must stay `published` until the side effects have
succeeded — commit-first would strand a retained revision whose denylist or
purge never happened, with no sweep to repair it.

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
