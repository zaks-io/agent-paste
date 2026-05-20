# Jobs Worker Trigger Model and Queue Topology

The `jobs` worker separates discovery from execution. Four Cron Triggers scan Postgres for due work and either act directly or enqueue per-target messages onto three isolated Cloudflare Queues (`byte-purge`, `safety-scan`, `bundle-generate`). This refines ADR 0019, which committed to Cloudflare Queues without specifying topology, by routing all time-based discovery through cron and reserving queues for per-target execution.

## Considered Options

- **Single queue with typed messages.** Simplest config, but head-of-line blocking risks across job kinds with very different latency profiles (fast denylist work behind slow bundle generation), and DLQ policy could not diverge per kind.
- **Per-kind queues plus request-enqueue-everything.** Removes the cron tier entirely by having `api` discover and enqueue lifecycle work at the moment it becomes due. Rejected because it pushes "scan the whole workspace" code paths onto request-handling Workers.
- **Two-tier (chosen).** Cron sweeps in `jobs` discover work and enqueue per-target messages; three isolated queues execute. Keeps `api` request paths free of tenant-wide scans and gives each execution kind its own isolation budget.

## Consequences

- Four Cron Triggers, each with its own cadence, all dispatched by the same `scheduled()` handler keyed on `event.cron`: Auto Deletion discovery, Retention discovery, Upload Cleanup, and maintenance GC (`idempotency_records` plus Audit Retention).
- Three queues with one consumer each: `byte-purge` (R2 prefix delete; batch size 50), `safety-scan` (per-revision deep scan; batch size 1), `bundle-generate` (per-revision zip + R2 write; batch size 1). Each has a dedicated DLQ.
- Deep safety scans and bundle generation are enqueued by `api` at **Publish** time. They are queue-only and never cron-discovered. Cron-discovered work covers Auto Deletion, Retention, Upload Cleanup, and idempotency GC.
- Each sweep query is `ORDER BY due_at ASC LIMIT N` with per-sweep caps (Auto Deletion 200, Retention 500, Upload Cleanup 200, Idempotency GC 5000). Caps bound the Worker CPU budget per cron invocation; the next tick picks up any remaining backlog.
- Backpressure is alert-and-intervene rather than automatic flow control. Sweeps enqueue at their cap regardless of downstream queue depth. Sustained `cap_hit=true` and queue-depth thresholds trigger alerts; the human response is to raise cadence, pause crons, or fan out to per-target dispatch queues — none of which are MVP work.
- Scaling to per-target dispatch queues (sweep enqueues "process-deletion-for-artifact-X" instead of doing the Deletion command inline) is a deferred config-only migration if any sweep's drain rate becomes inadequate.
- Auto Deletion and Retention crons fire up to one full cadence after a target crosses its TTL boundary. For the 30-day default, the timing slop is negligible. Upload Cleanup runs more frequently because upload-session TTLs are measured in minutes to hours.
