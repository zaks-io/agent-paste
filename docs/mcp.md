# MCP For Agents

The hosted MCP server is the path for agents that can connect to remote MCP
servers but cannot run the `agent-paste` CLI. It gives those agents the same
Artifact handoff model: publish generated work, read Agent Views, and add
Revisions without shell access.

Production endpoint:

```text
https://mcp.agent-paste.sh
```

Opening that URL directly returns endpoint metadata for humans and agents.
Protocol calls use `POST /` with Streamable HTTP JSON-RPC and an OAuth bearer
token; a browser GET is not the tool transport.

MCP clients can discover the transport and supported capability families from
`https://mcp.agent-paste.sh/.well-known/mcp/server-card.json`. The card reports
the environment-specific Streamable HTTP endpoint and advertises tools; this
server does not expose MCP resources or prompts.

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

MCP exposes ten tools:

| Tool                      | Purpose                                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `whoami`                  | Return the authenticated member, Workspace, and derived scopes.                                            |
| `publish_artifact`        | Publish a new text-only Artifact and return its top-level capability URL.                                  |
| `add_revision`            | Revise an Artifact in place: publish a text-only Revision under the same stable link. Preserves the title. |
| `multi_edit`              | Edit one file in an Artifact with literal find/replace (the Claude Edit model), publish it as a Revision.  |
| `list_artifacts`          | List Artifacts in the Workspace.                                                                           |
| `read_artifact`           | Read the latest Agent View for an Artifact.                                                                |
| `read_file`               | Read one stored file's bytes back (member plaintext) so you can edit against the current content.          |
| `list_revisions`          | List Revisions for an Artifact.                                                                            |
| `delete_artifact`         | Delete an Artifact.                                                                                        |
| `update_display_metadata` | Update an Artifact display title.                                                                          |

Publishing tools return one `url`: the unguessable, no-login, top-level
Artifact capability URL. It has no app viewer or iframe and stays stable across
Revisions. MCP publish output intentionally omits Artifact and Revision IDs;
use `list_artifacts`, `read_artifact`, or `list_revisions` when those fields are
needed.

Output shapes to keep straight:

- `list_artifacts` returns `data[]`; the Artifact ID field is `data[].id`.
- `read_artifact` returns the Agent View with `artifact_id`, `revision_id`,
  `files[].url`, and optional `bundle`.
- `list_revisions` returns `items[]`; the Revision ID field is
  `items[].revision_id`.

`add_revision` runs through the shared revise engine (`@agent-paste/revise-core`,
[ADR 0091](../adr/0091-client-side-revise-engine-and-literal-edit-tools.md)): it
reads the base Revision and **preserves the existing title** (it takes no title
parameter and no longer overwrites the title with the literal `"Revision"`; rename
explicitly via `update_display_metadata`), and publishes the new body as a verified
patch under the Artifact's stable `url`. When the new body's `sha256` equals the
stored bytes it is a **no-op**: no Revision is minted and the call echoes the
unchanged link, title, and expiry. A
`render_mode` change publishes a whole-file fresh-entrypoint Revision (the one
meaningful whole-body replace). When the call's entrypoint is not in the base tree
it falls back to a whole-file publish under the same Artifact. The Revision inherits
the base's Render Mode unless the call sets one.

`multi_edit` is the targeted-edit twin of `add_revision`, the parity match for the
CLI `edit` verb. It takes an `artifact_id`, a `path`, and an ordered `edits` array
of `{ old_string, new_string, replace_all? }` — the same shape as Claude's Edit
tool — and runs through the same `@agent-paste/revise-core` engine: it reads the
named file, applies the literal edits client-side, and publishes the result as a
Revision under the Artifact's stable `url`, preserving the title. Matching
is **literal and fail-loud**: each `old_string` must be non-empty and match exactly
once (set `replace_all` to change every occurrence); a not-found or ambiguous match
returns an `invalid_request` (HTTP 400) naming the offending edit index instead of
guessing, so the agent re-reads with `read_file` and retries. The server's stored
sha256 is the source of truth. Edits that reproduce the current bytes are a no-op
that mints no Revision and echoes the unchanged link, title, and expiry.

## Capabilities

MCP uses OAuth for authentication, but agent-paste does not trust OAuth scopes as
the source of product authorization. Capabilities come from the authenticated
Workspace Member in `api`, using one shared scope vocabulary (the same names the
API uses); MCP scopes are the member's stored API scopes verbatim, no translation:

| Scope     | Grants                  | Tools                                                                                          |
| --------- | ----------------------- | ---------------------------------------------------------------------------------------------- |
| `read`    | View your own Artifacts | `whoami`, `list_artifacts`, `read_artifact`, `read_file`, `list_revisions`                     |
| `publish` | Change your own content | `publish_artifact`, `add_revision`, `multi_edit`, `delete_artifact`, `update_display_metadata` |

`admin` exists but is dashboard-only (account/workspace management); no MCP tool
needs it. Today, normal Workspace members are provisioned with `read`, `publish`,
and `admin`. Future read-only roles can change in the database without changing
the MCP host connection.

## Limits

- MCP publish is text-only today.
- Folder upload, binary upload, and Bundle download stay in the CLI. Dashboard
  settings, billing, and lockdown controls stay in the dashboard.
- MCP is not an anonymous publish path. Agents with no account and no OAuth host
  should first check CLI auth with `agent-paste whoami --json`; if no login is
  available, they can use `agent-paste publish --ephemeral` through the CLI for
  restricted accountless handoffs such as text, images, markdown, or static
  sites. That path returns `url` for immediate no-login viewing and `claim_url`
  only for optional keep/upgrade.
- Artifact lifetime follows Workspace Auto Deletion policy. MCP callers do not
  choose TTL.

## Retired tools

Visibility and Access Link tools are gone. Every successful publish already
returns the no-login capability `url`, so agents do not need a second sharing
step.

## Deeper References

- [`apps/mcp/README.md`](../apps/mcp/README.md): Worker endpoints and implementation map.
- [`packages/contracts/src/mcp/registry.ts`](../packages/contracts/src/mcp/registry.ts): canonical tool registry.
- [`docs/ops/runbook-mcp-hosts.md`](./ops/runbook-mcp-hosts.md): operator and host onboarding details.
- [`docs/adr/0061-mcp-worker-with-oauth-only-via-auth0-dcr.md`](./adr/0061-mcp-worker-with-oauth-only-via-auth0-dcr.md): MCP transport and OAuth decision.
- [`docs/adr/0079-mcp-scopes-derived-from-member-role-not-workos-token.md`](./adr/0079-mcp-scopes-derived-from-member-role-not-workos-token.md): capability source decision.
