# api

Planned authenticated control-plane Cloudflare Worker.

Responsibilities:

- Auth0 and API Key authentication.
- Scope checks.
- Workspace RLS context.
- Artifact publish and management routes.
- Access Link creation, minting, revocation, and resolve.
- API Key management.
- Audit reads.
- Operator admin routes.

Contracts: [`docs/specs/api.md`](../../docs/specs/api.md) and [`packages/contracts`](../../packages/contracts).
