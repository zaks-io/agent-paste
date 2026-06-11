# MCP For Agents

The hosted MCP server is the path for agents that can connect to remote MCP
servers but cannot run the `agent-paste` CLI. It gives those agents the same
Artifact handoff model: publish generated work, read Agent Views, add Revisions,
and create or revoke Access Links without shell access.

Production endpoint:

```text
https://mcp.agent-paste.sh
```

## When To Use MCP

Use MCP when:

- The agent runs inside a hosted tool that cannot install npm packages, spawn a
  local process, or read a local keychain.
- The host supports remote MCP servers with OAuth.
- The work product is text that can be published through an MCP tool call.
- Another agent needs to inspect an existing Artifact through Agent View instead
  of scraping a browser page.

Use the CLI instead when the agent can run commands and needs to publish a file
tree, binary files, images, audio, video, or a complete static folder.

## Connect

Add `https://mcp.agent-paste.sh` as a remote MCP server in the host, then
complete the OAuth flow when prompted. MCP does not accept API Keys, dashboard
cookies, or copied session tokens.

OAuth discovery is hosted at `/.well-known/oauth-protected-resource`. The root
MCP resource identifier is `https://mcp.agent-paste.sh/`; clients should discover
it automatically and should not require a manually configured OAuth resource.

The WorkOS user must already belong to a Workspace. Signing in to the dashboard
or running `agent-paste login` creates the member row. Once connected, run the
`whoami` tool first; it reports the Workspace and the derived MCP capabilities
available to the agent.

Common remote-MCP hosts:

| Host           | Setup                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| Cursor         | Add a remote MCP server with URL `https://mcp.agent-paste.sh`.                                        |
| Codex          | Run `codex mcp add agent-paste --url https://mcp.agent-paste.sh`, then `codex mcp login agent-paste`. |
| Claude Desktop | Add the server URL in connector settings and complete OAuth.                                          |
| Claude.ai      | Add a custom MCP connector with server URL `https://mcp.agent-paste.sh`.                              |
| ChatGPT        | Register the MCP connector with server URL `https://mcp.agent-paste.sh`.                              |

Host-specific OAuth and redirect notes live in
[`docs/ops/runbook-mcp-hosts.md`](./ops/runbook-mcp-hosts.md).

## What Agents Can Do

MCP exposes twelve tools:

| Tool                      | Purpose                                                                         |
| ------------------------- | ------------------------------------------------------------------------------- |
| `whoami`                  | Return the authenticated member, Workspace, and derived scopes.                 |
| `publish_artifact`        | Publish a new text-only Artifact without creating a public link by default.     |
| `add_revision`            | Add and publish a text-only Revision without creating a public link by default. |
| `list_artifacts`          | List Artifacts in the Workspace.                                                |
| `read_artifact`           | Read the latest Agent View for an Artifact.                                     |
| `list_revisions`          | List Revisions for an Artifact.                                                 |
| `delete_artifact`         | Delete an Artifact.                                                             |
| `update_display_metadata` | Update an Artifact display title.                                               |
| `create_share_link`       | Create a Share Link and mint its Access Link Signed URL.                        |
| `create_revision_link`    | Create and mint a snapshot Access Link for a specific Revision.                 |
| `list_access_links`       | List Share Links and Revision Links for an Artifact.                            |
| `revoke_access_link`      | Revoke a Share Link or Revision Link.                                           |

Publishing tools default `share` to `false`. They do not create or reuse Share
Links unless the user explicitly asks for a public/shareable Access Link. When
`share: true`, `publish_artifact` creates a Share Link and `add_revision` reuses
an active Share Link when one exists, creating one only when needed. Return
`access_link_url` only for that explicit share flow.
MCP publish output intentionally omits Artifact IDs, Revision IDs,
`artifact_url`, `revision_content_url`, and `agent_view_url`; use
`list_artifacts`, `read_artifact`, `list_revisions`, or explicit link tools when
those fields are needed. Use `create_revision_link` only when the reader must see
one exact Revision.

## Capabilities

MCP uses OAuth for authentication, but agent-paste does not trust OAuth scopes as
the source of product authorization. Capabilities come from the authenticated
Workspace Member in `api`:

| MCP capability | Backed by member scope | Typical tools                                                                          |
| -------------- | ---------------------- | -------------------------------------------------------------------------------------- |
| `read`         | `read`                 | `list_artifacts`, `read_artifact`, `list_revisions`, `whoami`                          |
| `write`        | `publish`              | `publish_artifact`, `add_revision`, `delete_artifact`, `update_display_metadata`       |
| `share`        | `admin`                | `create_share_link`, `create_revision_link`, `list_access_links`, `revoke_access_link` |

Today, normal Workspace members are provisioned with the full set. Future
read-only or share-limited roles can change in the database without changing the
MCP host connection.

## Limits

- MCP publish is text-only today.
- Folder upload, binary upload, Bundle download, dashboard settings, billing,
  and lockdown controls stay in CLI, REST, or dashboard surfaces.
- MCP is not an anonymous publish path. Agents with no account and no OAuth host
  should first check CLI auth with `agent-paste whoami`; if no login or key is
  available, they can use `agent-paste publish --ephemeral` through the CLI for
  restricted accountless non-interactive handoffs such as text, images,
  markdown, or static HTML/CSS. Interactive HTML/JS needs authenticated publish.
- Artifact lifetime follows Workspace Auto Deletion policy. MCP callers do not
  choose TTL.

## Deeper References

- [`apps/mcp/README.md`](../apps/mcp/README.md): Worker endpoints and implementation map.
- [`packages/contracts/src/mcp/registry.ts`](../packages/contracts/src/mcp/registry.ts): canonical tool registry.
- [`docs/ops/runbook-mcp-hosts.md`](./ops/runbook-mcp-hosts.md): operator and host onboarding details.
- [`docs/adr/0061-mcp-worker-with-oauth-only-via-auth0-dcr.md`](./adr/0061-mcp-worker-with-oauth-only-via-auth0-dcr.md): MCP transport and OAuth decision.
- [`docs/adr/0079-mcp-scopes-derived-from-member-role-not-workos-token.md`](./adr/0079-mcp-scopes-derived-from-member-role-not-workos-token.md): capability source decision.
