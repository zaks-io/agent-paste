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
complete the OAuth flow when prompted. MCP uses OAuth only; dashboard cookies,
copied session tokens, and local CLI credentials do not authenticate MCP calls.

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

| Tool                      | Purpose                                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `whoami`                  | Return the authenticated member, Workspace, and derived scopes.                                            |
| `publish_artifact`        | Publish a new text-only Artifact. Content-only and private.                                                |
| `add_revision`            | Revise an Artifact in place: publish a text-only Revision under the same stable link. Preserves the title. |
| `list_artifacts`          | List Artifacts in the Workspace.                                                                           |
| `read_artifact`           | Read the latest Agent View for an Artifact.                                                                |
| `list_revisions`          | List Revisions for an Artifact.                                                                            |
| `delete_artifact`         | Delete an Artifact.                                                                                        |
| `update_display_metadata` | Update an Artifact display title.                                                                          |
| `make_public`             | Mint or reuse the Artifact's one Share Link and return its public, no-login Access Link Signed URL.        |
| `create_revision_link`    | Create and mint a snapshot Access Link for a specific Revision.                                            |
| `list_access_links`       | List Share Links and Revision Links for an Artifact.                                                       |
| `revoke_access_link`      | Revoke a Share Link or Revision Link.                                                                      |

Publishing tools are content-only and private: they take no visibility input and
return one link, `private_url` — the login-walled clean viewer at
`/v/<artifactId>` for the owning Workspace Member. There is no `share` input and
no `shared` output, and the result carries no `access_link_url`. To make an
Artifact public, call `make_public` as a separate step; it mints or reuses the
one Share Link and returns its no-login Access Link Signed URL.
MCP publish output intentionally omits Artifact IDs, Revision IDs,
`revision_content_url`, and `agent_view_url`; use `list_artifacts`,
`read_artifact`, `list_revisions`, or explicit link tools when those fields are
needed. Use `create_revision_link` only when the reader must see one exact
Revision.

`add_revision` runs through the shared revise engine (`@agent-paste/revise-core`,
[ADR 0091](../adr/0091-client-side-revise-engine-and-literal-edit-tools.md)): it
reads the base Revision and **preserves the existing title** (it takes no title
parameter and no longer overwrites the title with the literal `"Revision"`; rename
explicitly via `update_display_metadata`), and publishes the new body as a verified
patch under the Artifact's stable `private_url` so already-open viewers live-update
in place. When the new body's `sha256` equals the stored bytes it is a **no-op** —
no Revision is minted and the call echoes the unchanged link, title, and expiry. A
`render_mode` change publishes a whole-file fresh-entrypoint Revision (the one
meaningful whole-body replace). When the call's entrypoint is not in the base tree
it falls back to a whole-file publish under the same Artifact. The Revision inherits
the base's Render Mode unless the call sets one.

## Capabilities

MCP uses OAuth for authentication, but agent-paste does not trust OAuth scopes as
the source of product authorization. Capabilities come from the authenticated
Workspace Member in `api`, using one shared scope vocabulary (the same names the
API uses); MCP scopes are the member's stored API scopes verbatim, no translation:

| Scope     | Grants                                           | Tools                                                                                                                                         |
| --------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `read`    | View your own Artifacts and links                | `whoami`, `list_artifacts`, `read_artifact`, `list_revisions`, `list_access_links`                                                            |
| `publish` | Change your own content and manage public access | `publish_artifact`, `add_revision`, `delete_artifact`, `update_display_metadata`, `make_public`, `create_revision_link`, `revoke_access_link` |

`admin` exists but is dashboard-only (account/workspace management); no MCP tool
needs it. Today, normal Workspace members are provisioned with `read`, `publish`,
and `admin`. Future read-only roles can change in the database without changing
the MCP host connection.

## Limits

- MCP publish is text-only today.
- Folder upload, binary upload, and Bundle download stay in the CLI. Dashboard
  settings, billing, and lockdown controls stay in the dashboard.
- MCP is not an anonymous publish path. Agents with no account and no OAuth host
  should first check CLI auth with `agent-paste whoami`; if no login is
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
