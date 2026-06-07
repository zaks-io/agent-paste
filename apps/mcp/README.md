# mcp

OAuth-only hosted MCP Worker for agent-paste.

User-facing MCP guide: [`docs/mcp.md`](../../docs/mcp.md). Use MCP when an agent
can connect to a remote MCP server but cannot run the CLI.

Responsibilities:

- Streamable HTTP MCP transport.
- OAuth protected resource metadata.
- WorkOS JWT bearer verification.
- Forwarding to `api` and `upload` over service bindings.
- Text-only MCP tool surface (twelve tools).

Contracts: [ADR 0061](../../docs/adr/0061-mcp-worker-with-oauth-only-via-auth0-dcr.md) and [`packages/contracts/src/mcp.ts`](../../packages/contracts/src/mcp.ts).

Host onboarding and smoke commands: [`docs/ops/runbook-mcp-hosts.md`](../../docs/ops/runbook-mcp-hosts.md).

Current endpoints:

- `POST /` - Streamable HTTP MCP transport (JSON-RPC; optional SSE responses)
- `GET /` - returns `405` in stateless v1 (no standalone SSE stream)
- `GET /healthz`
- `GET /.well-known/oauth-protected-resource`
- `GET /openapi.json`

Transport auth is OAuth-bearer only via WorkOS JWT verification. Authenticated
tool calls forward to `api` and `upload` over service bindings with the same
bearer. The ADR 0061 twelve-tool surface is implemented in `src/tools.ts` with
schema validation, scope checks, and API error mapping.

## Tools

Twelve tools, gated by MCP capabilities (`read`, `write`, `share`) derived by
`api` from the authenticated Workspace Member. WorkOS AuthKit tokens carry
standard OAuth scopes; they do not directly grant these capabilities. Canonical
contract: [`packages/contracts/src/mcp/registry.ts`](../../packages/contracts/src/mcp/registry.ts).

| Tool                      | Scopes               | Purpose                                                  |
| ------------------------- | -------------------- | -------------------------------------------------------- |
| `whoami`                  | (none)               | Authenticated member, workspace, and derived scopes.     |
| `list_artifacts`          | `read`               | List Artifacts in the workspace.                         |
| `read_artifact`           | `read`               | Latest Agent View for an Artifact.                       |
| `list_revisions`          | `read`               | List Revisions for an Artifact.                          |
| `publish_artifact`        | `write, read, share` | Publish a new text Artifact; mint its Revision Link.     |
| `add_revision`            | `write, read, share` | Add and publish a Revision; mint its Revision Link.      |
| `delete_artifact`         | `write`              | Delete an Artifact.                                      |
| `update_display_metadata` | `write`              | Update an Artifact's display title.                      |
| `create_share_link`       | `read, share`        | Create and mint a Share Link for the latest Revision.    |
| `create_revision_link`    | `read, share`        | Create and mint a Revision Link for a specific Revision. |
| `list_access_links`       | `read, share`        | List an Artifact's Share Links and Revision Links.       |
| `revoke_access_link`      | `share`              | Revoke a Share Link or Revision Link.                    |

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
