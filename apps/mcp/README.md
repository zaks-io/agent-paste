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
- MCP tool surface (fourteen tools).

Contracts: [ADR 0061](../../docs/adr/0061-mcp-worker-with-oauth-only-via-auth0-dcr.md) and [`packages/contracts/src/mcp.ts`](../../packages/contracts/src/mcp.ts).

Host onboarding and smoke commands: [`docs/ops/runbook-mcp-hosts.md`](../../docs/ops/runbook-mcp-hosts.md).

Current endpoints:

- `POST /` - Streamable HTTP MCP transport (JSON-RPC; optional SSE responses)
- `GET /` - endpoint metadata for humans and agents opening the MCP URL
- `GET /healthz`
- `GET /.well-known/oauth-protected-resource`
- `GET /.well-known/oauth-authorization-server`
- `GET /.well-known/openid-configuration`
- `GET /openapi.json`

Transport auth is OAuth-bearer only via WorkOS JWT verification. Authenticated
tool calls forward to `api` and `upload` over service bindings with the same
bearer. The current fourteen-tool surface is implemented in `src/tools.ts` with
schema validation, scope checks, and API error mapping.

## Tools

Fourteen tools, gated by MCP capabilities (`read`, `publish`, `admin`) derived by
`api` from the authenticated Workspace Member. WorkOS AuthKit tokens carry
standard OAuth scopes; they do not directly grant these capabilities. Canonical
contract: [`packages/contracts/src/mcp/registry.ts`](../../packages/contracts/src/mcp/registry.ts).

| Tool                      | Scopes          | Purpose                                                                                         |
| ------------------------- | --------------- | ----------------------------------------------------------------------------------------------- |
| `whoami`                  | (none)          | Authenticated member, workspace, and derived scopes.                                            |
| `list_artifacts`          | `read`          | List Artifacts in the workspace.                                                                |
| `read_artifact`           | `read`          | Latest Agent View for an Artifact.                                                              |
| `read_file`               | `read`          | Read one stored Artifact file for edit/revise workflows.                                        |
| `list_revisions`          | `read`          | List Revisions for an Artifact.                                                                 |
| `publish_artifact`        | `publish, read` | Publish a new text Artifact. Content-only and private.                                          |
| `add_revision`            | `publish, read` | Add and publish a Revision. Content-only and private.                                           |
| `multi_edit`              | `publish, read` | Apply literal edits to one stored text file and publish a new Revision.                         |
| `delete_artifact`         | `publish`       | Delete an Artifact.                                                                             |
| `update_display_metadata` | `publish`       | Update an Artifact's display title.                                                             |
| `make_public`             | `publish, read` | Mint or reuse the Artifact's Share Link and return its public, no-login Access Link Signed URL. |
| `create_revision_link`    | `publish, read` | Create and mint a snapshot Access Link for a specific Revision.                                 |
| `list_access_links`       | `publish, read` | List an Artifact's Share Links and Revision Links.                                              |
| `revoke_access_link`      | `publish`       | Revoke a Share Link or Revision Link.                                                           |

`publish_artifact` and `add_revision` are **content-only and private**: they take
no visibility input and return one link, `private_url` — the login-walled clean
viewer at `/v/<artifactId>` for the owning Workspace Member. There is no `share`
input and no `shared` output, and the result carries no `access_link_url`. To
make an Artifact public, call `make_public` as a separate step; it mints or
reuses the one Share Link and returns its no-login Access Link Signed URL. The
publish output intentionally omits Artifact IDs, Revision IDs,
`revision_content_url`, and `agent_view_url`; use `list_artifacts`,
`read_artifact`, `list_revisions`, or explicit link tools when those fields are
needed.

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
