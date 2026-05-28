# mcp

OAuth-only hosted MCP Worker for agent-paste.

Responsibilities:

- Streamable HTTP MCP transport.
- OAuth protected resource metadata.
- WorkOS JWT bearer verification.
- Forwarding to `api` and `upload` over service bindings.
- Text-only MCP tool surface (twelve tools).

Contracts: [ADR 0061](../../docs/adr/0061-mcp-worker-with-oauth-only-via-auth0-dcr.md) and [`packages/contracts/src/mcp.ts`](../../packages/contracts/src/mcp.ts).

Host onboarding and smoke commands: [`docs/ops/runbook-mcp-hosts.md`](../../docs/ops/runbook-mcp-hosts.md).

Current endpoints:

- `POST /` — Streamable HTTP MCP transport (JSON-RPC; optional SSE responses)
- `GET /` — returns `405` in stateless v1 (no standalone SSE stream)
- `GET /healthz`
- `GET /.well-known/oauth-protected-resource`
- `GET /openapi.json`

Transport auth is OAuth-bearer only via WorkOS JWT verification. Authenticated
tool calls forward to `api` and `upload` over service bindings with the same
bearer. The ADR 0061 twelve-tool surface is implemented in `src/tools.ts` with
schema validation, scope checks, and API error mapping.

## Local verification

```sh
pnpm --filter @agent-paste/mcp test
pnpm smoke:mcp
```

## Hosted URLs

| Environment | URL                                  |
| ----------- | ------------------------------------ |
| Preview     | `https://mcp.preview.agent-paste.sh` |
| Production  | `https://mcp.agent-paste.sh`         |
