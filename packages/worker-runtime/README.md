# worker-runtime

Contract-driven Worker runtime helpers for Hono apps.

Responsibilities:

- Mount `@agent-paste/contracts` route contracts through a shared registrar.
- Resolve principals through per-Worker auth resolvers.
- Enforce route-declared scopes, idempotency header requirements, and rate-limit class.
- Centralize public error status mapping.

Apps still own their domain handlers and bindings. This package owns the common request guard around those handlers.
