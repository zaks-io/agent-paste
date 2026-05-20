# Upload Write Path with Reserved IDs and Soft DB Boundaries

The `upload` worker reserves `artifactId` and `revisionId` at **Upload Session** creation but does not insert rows into `artifacts` or `revisions` until finalization. R2 keys are derived from the reserved IDs so direct-to-R2 uploads land at final keys per ADR 0021, and an abandoned or terminally failed session never leaks management rows. The Postgres write boundary between workers is intentionally soft: `upload`, `api`, and `jobs` all write to `artifacts` and `revisions`, split by lifecycle phase rather than by table ownership.

## Consequences

- `POST /upload-sessions` returns `{ session_id, artifact_id, revision_id, files: [{ path, put_url }] }` where `artifact_id` and `revision_id` are reserved identifiers, not yet persisted as rows.
- Signed PUT URLs include `Content-Length` as a signed header and are bound to the session TTL.
- `POST /upload-sessions/{id}/finalize` runs one `runCommand` transaction that INSERTs the `artifacts` row when the artifact is new (emitting the Unpublished-Artifact-creation **Audit Event**) and the `revisions` row with `status='draft'` (operational log only per ADR 0004).
- Session creation, abandonment, expiration, lost-race finalize, and unexpected-object finalize are operational logs. They never produce **Audit Events** because no product-visible state was created.
- `api` owns all post-finalize **Draft Revision** transitions: promote to **Published Revision** via **Publish**, and discard. `upload` does not expose discard.
- `jobs` writes `revisions.status='retained'` during **Retention** sweeps and physically deletes R2 bytes for retained or **Deletion** targets. `api` enqueues the work; `jobs` performs it.
- The R2 binding boundary remains hard: `api` has no binding, `upload` writes (signed URLs and finalize verification), `content` reads, `jobs` writes and deletes.
- **Upload Cleanup** in `jobs` is a periodic cron sweep over terminal or expired sessions. Only R2 bytes need cleanup from the upload flow; orphan **Unpublished Artifacts** only arise from future dashboard-driven flows on `api`, which is when ADR 0019's audit-on-stale-removal applies.
- **Usage Policy** quota checks (artifact count, revision size sum) run as a friendly pre-flight at session creation and as the hard enforcement at finalize. Race losses between the two checks waste an upload but are bounded by session TTL.
