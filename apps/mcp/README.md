# mcp

OAuth-only hosted MCP Worker for agent-paste.

User-facing MCP guide: [`docs/mcp.md`](../../docs/mcp.md). Use MCP when an agent
can connect to a remote MCP server but cannot run the CLI.

Responsibilities:

- Streamable HTTP MCP transport.
- OAuth protected resource metadata.
- OAuth authorization-server metadata facade for compatibility clients.
- WorkOS JWT bearer verification.
- Forwarding to `api` and `upload` over service bindings.
- Text-only MCP tool surface (ten tools).

Contracts: [ADR 0061](../../docs/adr/0061-mcp-worker-with-oauth-only-via-auth0-dcr.md) and [`packages/contracts/src/mcp/registry.ts`](../../packages/contracts/src/mcp/registry.ts).

Host onboarding and smoke commands: [`docs/ops/runbook-mcp-hosts.md`](../../docs/ops/runbook-mcp-hosts.md).

Current endpoints:

- `POST /` - Streamable HTTP MCP transport (JSON-RPC; optional SSE responses)
- `GET /` - endpoint metadata for humans and agents opening the MCP URL
- `GET /healthz`
- `GET /.well-known/mcp/server-card.json`
- `GET /.well-known/oauth-protected-resource`
- `GET /.well-known/oauth-authorization-server`
- `GET /.well-known/openid-configuration`
- `GET /openapi.json`

Transport auth is OAuth-bearer only via WorkOS JWT verification. Authenticated
tool calls forward to `api` and `upload` over service bindings with the same
bearer. The current ten-tool surface is defined in
`packages/contracts/src/mcp/registry.ts` and implemented in `src/tools.ts` with
schema validation, scope checks, and API error mapping.

## Tools

Ten tools, gated by MCP capabilities (`read`, `publish`, `admin`) derived by
`api` from the authenticated Workspace Member. WorkOS AuthKit tokens carry
standard OAuth scopes; they do not directly grant these scopes. Canonical
contract: [`packages/contracts/src/mcp/registry.ts`](../../packages/contracts/src/mcp/registry.ts).

| Tool                      | Scopes          | Purpose                                                                 |
| ------------------------- | --------------- | ----------------------------------------------------------------------- |
| `whoami`                  | (none)          | Authenticated member, workspace, and derived scopes.                    |
| `list_artifacts`          | `read`          | List Artifacts in the workspace.                                        |
| `read_artifact`           | `read`          | Latest Agent View for an Artifact.                                      |
| `read_file`               | `read`          | Read one stored Artifact file for edit/revise workflows.                |
| `list_revisions`          | `read`          | List Revisions for an Artifact.                                         |
| `publish_artifact`        | `publish, read` | Publish a new text Artifact and return its top-level capability URL.    |
| `add_revision`            | `publish, read` | Add and publish a Revision while keeping the Artifact URL stable.       |
| `multi_edit`              | `publish, read` | Apply literal edits to one stored text file and publish a new Revision. |
| `delete_artifact`         | `publish`       | Delete an Artifact.                                                     |
| `update_display_metadata` | `publish`       | Update an Artifact's display title.                                     |

`publish_artifact` and `add_revision` return one `url`: the unguessable,
no-login, top-level Artifact capability URL. It has no app viewer or iframe and
stays stable across Revisions. Publish output also returns `artifact_id` and
`revision_id` for immediate follow-up reads or revisions.

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
