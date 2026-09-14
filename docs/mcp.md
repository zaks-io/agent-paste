# MCP For Agents

The hosted MCP server is for agents that can connect to remote MCP but cannot
run the `agent-paste` CLI. It publishes text Artifacts, reads Agent Views, and
adds Revisions without a shell.

```text
https://mcp.agent-paste.sh
```

`POST /` is the Streamable HTTP transport. `GET /` returns endpoint metadata,
and `/.well-known/mcp/server-card.json` advertises the transport and tools. The
server exposes no MCP resources or prompts.

## When to use MCP

Use MCP when the host cannot install packages, spawn a process, or read a local
keychain, but does support remote MCP with OAuth. Use the CLI when commands are
available, and always for folders, binary files, images, audio, video, and
ephemeral publishing.

If a shell exists but browser OAuth cannot complete there, use
`agent-paste login --device-code` instead of MCP. See
[CLI remote login](../apps/cli/README.md#agent-quick-path). MCP is OAuth-only and
cannot use the CLI's stored credential or `AGENT_PASTE_API_KEY`.

## Connect

Add `https://mcp.agent-paste.sh` as a remote MCP server and complete OAuth.
Dashboard cookies, copied session tokens, and CLI credentials do not
authenticate MCP calls. OAuth discovery is at
`/.well-known/oauth-protected-resource`; the resource identifier is
`https://mcp.agent-paste.sh/` and clients should discover it automatically.

The user must already belong to a Workspace. Signing in to the dashboard or
running `agent-paste login` once creates it. Call `whoami` first; it reports the
Workspace and the scopes available.

| Host           | Setup                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| Cursor         | Add a remote MCP server with URL `https://mcp.agent-paste.sh`.                                        |
| Codex          | Run `codex mcp add agent-paste --url https://mcp.agent-paste.sh`, then `codex mcp login agent-paste`. |
| Claude Desktop | Add the server URL in connector settings and complete OAuth.                                          |
| Claude.ai      | Add a custom MCP connector with server URL `https://mcp.agent-paste.sh`.                              |
| ChatGPT        | Register the MCP connector with server URL `https://mcp.agent-paste.sh`.                              |

Host-specific OAuth and redirect notes:
[`docs/ops/runbook-mcp-hosts.md`](./ops/runbook-mcp-hosts.md).

## Tools

| Tool                      | Scope             | Purpose                                                                         |
| ------------------------- | ----------------- | ------------------------------------------------------------------------------- |
| `whoami`                  | none              | Authenticated member, Workspace, and scopes.                                    |
| `publish_artifact`        | `publish`, `read` | Publish a new text Artifact and return its `url`.                               |
| `add_revision`            | `publish`, `read` | Publish a new body for an existing Artifact at the same `url`. Keeps the title. |
| `multi_edit`              | `publish`, `read` | Literal find/replace in one stored file, published as a Revision.               |
| `list_artifacts`          | `read`            | List Workspace Artifacts. Returns `data[]`; the ID is `data[].id`.              |
| `read_artifact`           | `read`            | Latest Agent View: `artifact_id`, `revision_id`, `files[].url`, `bundle`.       |
| `read_file`               | `read`            | One stored file's text and sha256, for editing against current content.         |
| `list_revisions`          | `read`            | List Revisions. Returns `items[]`; the ID is `items[].revision_id`.             |
| `delete_artifact`         | `publish`         | Delete an Artifact.                                                             |
| `update_display_metadata` | `publish`         | Set an Artifact's title.                                                        |

Publishing tools return `url` (opens without login, same across Revisions),
`artifact_id`, `revision_id`, `title`, `expires_at`, and upload statistics.
`artifact_id` inputs accept the short ID (`01234-56789-abcde-fghjd`), the full
URL, or a legacy `art_...` ID. Workspace authorization applies to every call.

`add_revision` and `multi_edit` run through `@agent-paste/revise-core`
([ADR 0091](./adr/0091-client-side-revise-engine-and-literal-edit-tools.md)).
Both preserve the title; rename with `update_display_metadata`. A body or edit
set that reproduces the stored bytes is a no-op: no Revision is minted and the
call echoes the unchanged link, title, and expiry. `add_revision` inherits the
base Render Mode unless the call sets one; changing it publishes a fresh
entrypoint. `multi_edit` takes `artifact_id`, `path`, and an ordered `edits`
array of `{ old_string, new_string, replace_all? }`. Each `old_string` must
match exactly once unless `replace_all` is set; a miss or ambiguous match
returns `invalid_request` (HTTP 400) naming the edit index, so re-read with
`read_file` and retry.

## Scopes

OAuth authenticates the user; scopes come from the Workspace Member record in
`api`, not from the OAuth token. `read` covers `whoami`, `list_artifacts`,
`read_artifact`, `read_file`, and `list_revisions`. Publishing tools need `publish`
and `read`; `delete_artifact` and `update_display_metadata` need `publish`. Normal
members hold both. `admin` exists but no MCP tool needs it.

## Limits

- Text only. Folders, binary uploads, Bundle download, and ephemeral publishing
  stay in the CLI; settings, billing, and lockdown stay in the dashboard.
- Artifact lifetime follows Workspace Auto Deletion. MCP callers do not choose
  TTL.

## References

- [`apps/mcp/README.md`](../apps/mcp/README.md): Worker endpoints and implementation map.
- [`packages/contracts/src/mcp/registry.ts`](../packages/contracts/src/mcp/registry.ts): canonical tool registry.
- [`docs/ops/runbook-mcp-hosts.md`](./ops/runbook-mcp-hosts.md): host onboarding.
- [ADR 0061](./adr/0061-mcp-worker-with-oauth-only-via-auth0-dcr.md): transport and OAuth decision.
- [ADR 0079](./adr/0079-mcp-scopes-derived-from-member-role-not-workos-token.md): scope source decision.
