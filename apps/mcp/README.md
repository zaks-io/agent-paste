# mcp

Planned OAuth-only hosted MCP Worker.

Responsibilities:

- Streamable HTTP MCP transport.
- OAuth protected resource metadata.
- Auth0 bearer verification.
- Forwarding to `api` over service binding.
- Text-only MCP tool surface.

Contracts: [ADR 0061](../../docs/adr/0061-mcp-worker-with-oauth-only-via-auth0-dcr.md) and [`packages/contracts/src/mcp.ts`](../../packages/contracts/src/mcp.ts).
