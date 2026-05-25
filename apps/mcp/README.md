# mcp

Typed Hono scaffold for the planned OAuth-only hosted MCP Worker.

Responsibilities:

- Streamable HTTP MCP transport.
- OAuth protected resource metadata.
- OAuth bearer verification. The provider is expected to be re-decided when MCP work is promoted.
- Forwarding to `api` over service binding.
- Text-only MCP tool surface.

Contracts: [ADR 0061](../../docs/adr/0061-mcp-worker-with-oauth-only-via-auth0-dcr.md) and [`packages/contracts/src/mcp.ts`](../../packages/contracts/src/mcp.ts).

Current endpoints:

- `GET /healthz`
- `GET /.well-known/oauth-protected-resource`
- `GET /openapi.json`
