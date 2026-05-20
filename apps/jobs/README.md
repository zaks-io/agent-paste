# jobs

Planned background Cloudflare Worker.

Responsibilities:

- Cron discovery for Auto Deletion, Retention, Upload Cleanup, and maintenance GC.
- Queue consumers for byte purge, safety scan, and bundle generation.
- Bundle DLQ consumer.

Contracts: [`docs/specs/jobs.md`](../../docs/specs/jobs.md).
