# Audit State Changes Through a Mutation Wrapper

State changes will flow through an auditing wrapper, tentatively named `auditMutation`, so audit events are created as part of the normal write path rather than added manually after each feature. This makes auditing easier to maintain across artifact publishing, API key changes, share-link changes, deletion, usage policy enforcement, and warning generation.

## Consequences

- Mutations that change durable platform state should use the auditing wrapper by default.
- The wrapper should capture actor, workspace, action, target, timestamp, request context, and a redacted structured change summary.
- Sensitive values such as API key secrets and uploaded file contents should not be stored in audit events.
- Audit events should not store full before-and-after payloads when those payloads may contain secrets, private manifests, or artifact content.
