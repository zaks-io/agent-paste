# api-client

Internal TypeScript client consumed by `apps/cli` and web/CLI login credential flows.

Responsibilities:

- Auth resolution from an injected CLI credential, legacy environment credential,
  or injected bearer provider.
- Internal HTTP calls against `api` and `upload`.
- Publish and download composition.
- Retry and idempotency behavior.
- Cursor auto-pagination.

Contracts: [ADR 0037](../../docs/adr/0037-internal-api-client-package-powers-cli.md) and [`packages/contracts`](../contracts).
