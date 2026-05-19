# Audit State Changes Through Transactional Commands

State changes will flow through a transactional command pattern, tentatively named `runCommand`, so audit events are created in the same Postgres transaction as the durable state change. This makes auditing easier to maintain across artifact publishing, API key changes, share-link changes, deletion, usage policy enforcement, and warning generation.

## Consequences

- All durable business writes should use `runCommand`.
- `runCommand` should open a Postgres transaction, pass a transaction handle to domain write code, collect audit events, insert those audit events before commit, and roll back the whole transaction if state writes or audit writes fail.
- Audit events should capture actor, workspace, action, target, timestamp, request context, and a redacted structured change summary.
- Sensitive values such as API key secrets and uploaded file contents should not be stored in audit events.
- Audit events should not store full before-and-after payloads when those payloads may contain secrets, private manifests, or artifact content.
- Operational logs remain separate from transactional audit events and may be best-effort.
