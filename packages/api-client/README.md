# api-client

Planned internal TypeScript client consumed by `apps/cli`.

Responsibilities:

- Auth resolution from `AGENT_PASTE_API_KEY` or CLI login store.
- REST calls against `api` and `upload`.
- Publish and download composition.
- Retry and idempotency behavior.
- Cursor auto-pagination.

Contracts: [ADR 0037](../../docs/adr/0037-internal-api-client-package-powers-cli.md) and [`packages/contracts`](../contracts).
