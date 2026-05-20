# Safety Scanner Lifecycle: Stub Scope, REPLACE on Scan, Scanner Versioning

The MVP `safety-scan` consumer in `jobs` runs a stub scanner that exists to exercise the plumbing — warning storage, Agent View surfacing, async audit events, scanner versioning — rather than to provide real detection. **Safety Warnings** are stored per `(revision_id, scanner_id)` and each scan REPLACES all rows in that scope. `scanner_version` participates in the idempotency key so a version bump re-scans the same **Revision** without manual TTL expiry. Real scanner integration is deferred to a follow-up.

## Considered Options

- **Real scanner integration at MVP** (ClamAV-style, third-party, or Cloudflare's own Content Scanner). Stronger security posture day one but adds schedule risk and couples MVP shape to vendor APIs.
- **DIFF-on-scan.** Read existing warnings, compute add/change/remove, apply the delta. Preserves warning identity across scans. Rejected because the handler becomes a read-modify-write across rows for marginal benefit; audit events already capture per-scan change summaries.
- **Single global scanner with no versioning column.** Simplest schema but no clean re-scan trigger when scanner rules change; would require deleting `idempotency_records` rows manually to force re-scans.

## Consequences

- **`safety_warnings` table** keyed by `(id, revision_id, scanner_id, scanner_version, code, severity, file_path NULL, message, created_at)`. `file_path` is nullable because warnings can be revision-level rather than file-scoped. Indexed by `(revision_id)` for Agent View lookups.
- **REPLACE within `(revision_id, scanner_id)`.** Each `safety-scan` handler invocation deletes all rows for the scope and inserts the new set inside one `runCommand` transaction. Audit-event summary records the delta (`+A added, -B removed, =C unchanged`) computed at write time, but the table itself does not preserve historical warning rows.
- **`scanner_id` namespaces scanners.** Sync warnings written at publish time live under `scanner_id='publish_sync'` and are never touched by async scans. The MVP async scanner is `scanner_id='stub_v1'`. Future scanners get their own `scanner_id`. Two scanners produce two independent row sets for the same **Revision**, and the Agent View merges them into one `warnings` array without exposing which scanner produced which warning.
- **Idempotency key shape:** `(workspace_id, actor_id='safety_scan', operation='scan.write_warning', idempotency_key='{revision_id}:{scanner_id}:{scanner_version}')`. Bumping `scanner_version` produces a fresh key with no completed row, so the next enqueue re-scans even within the 24-hour idempotency TTL.
- **Publish-time enqueue is the only trigger for MVP.** Scanner-version-bump backfill (sweep all published revisions and enqueue scans with the new version) and workspace-member-initiated re-scan are deferred. When backfill ships, it will be an out-of-band ops command rather than a routine cron.
- **Scanner failures are quiet.** Per ADR 0019 no audit event is emitted for scan failures, and per ADR 0034 the `safety-scan-dlq` has no consumer. Existing warnings remain in place if a scan dead-letters; alerting fires on DLQ depth so operators can investigate.
- **Pre-scan state check.** The handler reads `revisions.status` and parent `artifacts.status`; if the revision is `retained` or the artifact is `deleted`, the handler returns idempotently without running the scanner.
- **Replaceability.** The stub scanner's interface — `(revision_files) → SafetyWarning[]` — is the seam where a real scanner SDK plugs in. Swapping in a real scanner is a code-only change to the scanner implementation plus a `scanner_id` and `scanner_version` bump; no schema migration.
