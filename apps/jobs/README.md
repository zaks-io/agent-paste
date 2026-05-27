# jobs

Cloudflare Worker for cron discovery and queue consumers (`byte-purge`, `safety-scan`, `bundle-generate`, and the `bundle-generate-dlq` terminal consumer).

Contracts: [`docs/specs/jobs.md`](../../docs/specs/jobs.md).

## Retry and terminal failure

| Queue                 | `max_retries` | DLQ                   | DLQ consumer      | Terminal behavior                                                                       |
| --------------------- | ------------- | --------------------- | ----------------- | --------------------------------------------------------------------------------------- |
| `byte-purge`          | 3 (default)   | `byte-purge-dlq`      | none              | R2 bytes remain; `bytes_purge_enqueued_at` marks enqueue. Operator triage on DLQ depth. |
| `safety-scan`         | 3 (default)   | `safety-scan-dlq`     | none              | Existing warnings unchanged. Operator triage on DLQ depth.                              |
| `bundle-generate`     | 5             | `bundle-generate-dlq` | `jobs` (batch 10) | DLQ runs `bundle.mark_failed` via `runCommand` and logs `final_failure=true`.           |
| `bundle-generate-dlq` | n/a           | n/a                   | `jobs`            | Marks `revisions.bundle_status='failed'`.                                               |

Handlers are idempotent by target identity (`workspace_id` + `actor_id` + `operation` + target row id), not queue message id.

## Cron discovery

| Cron           | Schedule       | Sweep                                                                                                  |
| -------------- | -------------- | ------------------------------------------------------------------------------------------------------ |
| Upload Cleanup | `*/15 * * * *` | Expire stale upload sessions and enqueue `byte-purge` for orphan prefixes.                             |
| Auto Deletion  | `0 * * * *`    | Discovery, expiry via `runCommand`, denylist write, and `byte-purge` enqueue.                          |
| Purge Recovery | `0 * * * *`    | Rediscover deleted/expired artifacts missing `bytes_purge_enqueued_at` and enqueue purge side effects. |
| Retention      | `0 * * * *`    | No-op until `revision_retention_days` exists on workspaces.                                            |
| Maintenance GC | `0 * * * *`    | Deletes aged `idempotency_records` and `operation_events` (no `runCommand`).                           |

## Commands

- `pnpm --filter @agent-paste/jobs test`
- `pnpm --filter @agent-paste/jobs typegen` — regenerate `src/worker-configuration.d.ts` after Wrangler binding changes.
- `pnpm --filter @agent-paste/jobs dev`
