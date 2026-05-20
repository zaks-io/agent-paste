# `runCommand` Sequencing and Idempotency Record Structure

`runCommand` opens one Postgres transaction per durable business write and runs a fixed sequence inside it: claim the idempotency record, run the domain handler, mark the idempotency record complete with the result, insert collected **Audit Events**, then commit. A single `idempotency_records` table is shared across all workers, keyed by `(workspace_id, actor_id, operation, idempotency_key)`. The CLI's publish-level key flows across `upload` and `api` as the same key, distinguished by stable dotted `operation` strings such as `upload.session.create`, `upload.session.finalize`, and `api.publish`. This tightens ADR 0004 (audit-in-tx) and ADR 0022 (idempotent mutations) into a concrete pattern that touches every mutation handler.

## Consequences

- `runCommand` lives in `packages/commands/` and is imported by `api`, `upload`, and `jobs`. Every durable business write goes through it; no handler talks to Postgres directly outside this wrapper.
- Sequence inside the transaction: `BEGIN` → `INSERT INTO idempotency_records ... ON CONFLICT DO NOTHING` with `status='in_flight'` → if the row already exists, `SELECT ... FOR UPDATE`; cached `status='completed'` returns the stored `result_json`, in-flight returns `409 idempotency_in_flight` with `retry_after` → run handler → mark `status='completed'` with `result_json` → insert collected audit events → `COMMIT`.
- The handler returns `{ result, audit }`; it never writes audit events itself. This makes audit-less mutations structurally impossible.
- `idempotency_records` columns: `workspace_id`, `actor_id`, `actor_type`, `operation`, `idempotency_key`, `status`, `result_json`, `correlation_id`, `trace_id`, `created_at`, `completed_at`. Unique constraint on `(workspace_id, actor_id, operation, idempotency_key)`.
- TTL is 24 hours. `jobs` runs a periodic sweep that deletes completed records older than 24 hours. The durable result identifiers (`artifact_id`, `revision_id`, `access_link_id`) live forever in their own tables; the idempotency record only exists to deduplicate retries.
- Concurrent retry of the same key returns `409 idempotency_in_flight` rather than waiting inside the Worker request. The client (CLI or otherwise) handles the wait via its own retry backoff.
- The CLI generates one publish-level idempotency key per `publish` invocation and sends it on `upload.session.create`, `upload.session.finalize`, and `api.publish`. Three rows are written, distinguished by `operation`; no collision and no per-call key minting.
- `operation` strings are stable public API contract elements because they are part of the idempotency key composite. Renaming an operation requires a migration path; adding new operations is backward-compatible.
- Failure during any step in the sequence rolls back the entire transaction, including the idempotency record. Retries re-attempt cleanly.
