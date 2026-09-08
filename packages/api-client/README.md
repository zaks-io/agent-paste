# api-client

Internal runtime TypeScript client consumed by `apps/cli` and `apps/mcp`.

Responsibilities:

- Auth resolution from an injected CLI credential, legacy environment credential,
  or injected bearer provider.
- Internal HTTP calls against `api` and `upload`.
- Publish and download composition.
- Idempotency composition and structured error decoding, including
  `Retry-After` seconds. Callers decide whether and when to retry.
- Cursor auto-pagination.

Contracts: [ADR 0037](../../docs/adr/0037-internal-api-client-package-powers-cli.md) and [`packages/contracts`](../contracts).
