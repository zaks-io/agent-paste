# api

Authenticated control-plane Cloudflare Worker.

Responsibilities:

- API Key authentication and WorkOS/operator authentication.
- Scope checks.
- Workspace-constrained artifact and management routes.
- Agent View JSON and browser-readable Agent View HTML.
- API Key management.
- Billing, ephemeral publish, and operation event reads.
- Operator admin routes.

Contracts: [`docs/specs/api.md`](../../docs/specs/api.md) and [`packages/contracts`](../../packages/contracts).
