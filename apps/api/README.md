# api

Authenticated control-plane Cloudflare Worker.

Responsibilities:

- API Key authentication and hashed admin bearer authentication.
- Scope checks.
- Workspace-constrained artifact and management routes.
- Agent View JSON and browser-readable Agent View HTML.
- API Key management.
- Operation event reads.
- Operator admin routes.

Contracts: [`docs/specs/api.md`](../../docs/specs/api.md) and [`packages/contracts`](../../packages/contracts).
