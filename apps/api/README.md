# api

Authenticated control-plane Cloudflare Worker.

Responsibilities:

- CLI credential, MCP OAuth, and WorkOS/operator authentication.
- Scope checks.
- Workspace-constrained artifact and management routes.
- Agent View JSON and browser-readable Agent View HTML.
- Credential management.
- Billing, ephemeral publish, and operation event reads.
- Operator admin routes.

Contracts: [`docs/specs/api.md`](../../docs/specs/api.md) and [`packages/contracts`](../../packages/contracts).
