# mcp

OAuth-only hosted MCP Worker for agent-paste. Agent-facing guide:
[`docs/mcp.md`](../../docs/mcp.md).

Responsibilities:

- Streamable HTTP MCP transport.
- OAuth protected-resource and authorization-server metadata.
- WorkOS JWT bearer verification. The bearer terminates here; tool calls forward
  only the verified subject to allowlisted named RPC entrypoints on `api` and
  `upload`, whose public HTTP routes reject MCP bearers.
- Ten text-only tools, defined in
  [`packages/contracts/src/mcp/registry.ts`](../../packages/contracts/src/mcp/registry.ts)
  and implemented in `src/tools.ts` with schema validation, scope checks, and
  API error mapping.

Decision trail: [ADR 0061](../../docs/adr/0061-mcp-worker-with-oauth-only-via-auth0-dcr.md).
Host onboarding and smoke commands: [`docs/ops/runbook-mcp-hosts.md`](../../docs/ops/runbook-mcp-hosts.md).

Endpoints:

- `POST /` Streamable HTTP MCP transport (JSON-RPC; optional SSE responses)
- `GET /` endpoint metadata
- `GET /healthz`
- `GET /.well-known/mcp/server-card.json`
- `GET /.well-known/oauth-protected-resource`
- `GET /.well-known/oauth-authorization-server`
- `GET /.well-known/openid-configuration`
- `GET /openapi.json`

## Scopes

Tools are gated by `read` and `publish`, taken from the authenticated Workspace
Member in `api`. WorkOS tokens carry standard OAuth scopes and do not grant
these directly.

| Scope             | Tools                                                            |
| ----------------- | ---------------------------------------------------------------- |
| none              | `whoami`                                                         |
| `read`            | `list_artifacts`, `read_artifact`, `read_file`, `list_revisions` |
| `publish`, `read` | `publish_artifact`, `add_revision`, `multi_edit`                 |
| `publish`         | `delete_artifact`, `update_display_metadata`                     |

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
