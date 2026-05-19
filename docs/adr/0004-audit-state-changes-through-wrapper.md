# Audit State Changes Through Transactional Commands

State changes will flow through a transactional command pattern, tentatively named `runCommand`, so audit events are created in the same Postgres transaction as the durable state change. This makes auditing easier to maintain across unpublished artifact creation, artifact publishing, display metadata changes, API key changes, access-link changes, Access Link Lockdown, deletion, usage policy enforcement, and warning generation.

## Consequences

- All durable business writes should use `runCommand`.
- `runCommand` should open a Postgres transaction, pass a transaction handle to domain write code, collect audit events, insert those audit events before commit, and roll back the whole transaction if state writes or audit writes fail.
- Audit events should capture actor, workspace, action, target, timestamp, correlation ID, request context such as IP address and user agent, and a redacted structured change summary.
- API key actors should be identified by stable key ID and human-assigned key name.
- Change summaries should include stable object IDs and safe display names where useful.
- Publish change summaries may include safe file paths and file counts, but never file contents.
- Sensitive values such as API key secrets and uploaded file contents should not be stored in audit events.
- Audit events should not store full before-and-after payloads when those payloads may contain secrets, private manifests, or artifact content.
- Access-link reads and private artifact reads should be operational access logs, not audit events.
- Failed authentication and authorization attempts should be operational security telemetry, not audit events by default.
- Upload session creation and finalization should be operational logs, not audit events, unless they create product-visible state beyond a draft.
- Discarding a finalized draft revision should create an audit event; abandoning an unfinalized upload session should remain operational.
- Routine Usage Policy rejections should be operational/product errors; durable Usage Policy enforcement changes should create audit events.
- Operational logs remain separate from transactional audit events and may be best-effort.
