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

| Cron              | Schedule       | Sweep                                                                                                                                                                                                                                                                                  |
| ----------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upload Cleanup    | `*/15 * * * *` | Expire stale upload sessions and enqueue `byte-purge` for orphan prefixes.                                                                                                                                                                                                             |
| Auto Deletion     | `0 * * * *`    | Discovery, expiry via `runCommand`, denylist write, and `byte-purge` enqueue.                                                                                                                                                                                                          |
| Purge Recovery    | `0 * * * *`    | Rediscover deleted/expired artifacts missing `bytes_purge_enqueued_at` and enqueue purge side effects.                                                                                                                                                                                 |
| Retention         | `0 * * * *`    | When `revision_retention_days` is set, discover stale non-current published revisions, write `rd:{revisionId}` denylist keys, enqueue revision-scoped `byte-purge` prefixes, then mark the revision `retained`. Skips rows when `BYTE_PURGE_QUEUE` or `DENYLIST` bindings are missing. |
| Maintenance GC    | `0 * * * *`    | Deletes aged `idempotency_records` and `operation_events` (no `runCommand`).                                                                                                                                                                                                           |
| Billing reconcile | `0 6 * * *`    | Daily Stripe subscription backstop via `@agent-paste/billing` when `BILLING_ENABLED=true` (ADR 0074).                                                                                                                                                                                  |

## Commands

- `pnpm --filter @agent-paste/jobs test`
- `pnpm --filter @agent-paste/jobs typegen` — regenerate `src/worker-configuration.d.ts` after Wrangler binding changes.
- `pnpm --filter @agent-paste/jobs dev`

## Ephemeral safety scanner secrets

Ephemeral-tier `safety-scan` messages use `scanner_id=ephemeral_tier` and require:

- Workers AI binding `AI` (configured in `wrangler.jsonc`) for Llama Guard 3 text moderation.
- `URL_SCANNER_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` runtime secrets for async URL Scanner verdicts (`wrangler secret put`, never committed).
- `API_BASE_URL` var so URL Scanner can scan the public agent-view URL.
- `AGENT_VIEW_SIGNING_SECRET` (or `CONTENT_SIGNING_SECRET` when agent-view shares content rotation) so the scanner can mint a valid signed public agent-view URL for the scan target.

Malicious URL Scanner verdicts create an artifact-scoped Platform Lockdown and write the content denylist. Scanner failures stay quiet per ADR 0051.
