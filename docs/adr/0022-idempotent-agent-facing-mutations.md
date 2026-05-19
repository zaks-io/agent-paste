# Idempotent Agent-Facing Mutations

Agent-facing mutation endpoints will support idempotency keys from day one so retries do not create duplicate artifacts, revisions, upload sessions, or share links. Idempotency records should be stored in Postgres and scoped by workspace, actor, operation, and client-provided idempotency key.

## Consequences

- Publish, upload session creation, upload finalization, and share-link creation should require or strongly enforce idempotency keys.
- Naturally idempotent operations such as revoke and delete should return stable success responses when repeated.
- Idempotency records should store the operation result or enough metadata to replay the same response safely.
- Idempotency handling should run inside the same transactional command pattern as the durable write it protects.
