# agent-paste

Command-line interface for publishing shareable **Artifacts** as an agent. The CLI is the agent-facing wrapper around the public REST API; see [ADR 0017](../../docs/adr/0017-openapi-contract-with-ergonomic-sdk-and-cli.md) and [ADR 0037](../../docs/adr/0037-internal-api-client-package-powers-cli.md) for why the API client is workspace-internal rather than a separately published SDK.

## Install

No install required. The canonical invocation is:

```sh
npx agent-paste publish <path>
```

For repeated use:

```sh
npm install -g agent-paste
```

## Authenticate

For interactive use, sign in with WorkOS. `login` runs a loopback PKCE flow in your browser, mints a scoped **API Key**, and stores it (macOS Keychain, or `~/.config/agent-paste/credentials.json` at mode `0600` elsewhere). The WorkOS token is discarded after the key is minted.

```sh
agent-paste login
agent-paste logout
```

The minted key is capped at `publish` and `read`. CLI sign-in never grants `admin`.

For CI and headless agents, set `AGENT_PASTE_API_KEY` in the environment:

```sh
export AGENT_PASTE_API_KEY=ap_pk_production_...
```

`AGENT_PASTE_API_KEY` takes precedence over a stored login credential; when both are present the CLI prints a one-line note to stderr naming which it used. The CLI does not accept secrets as flags. API Keys encode their **Workspace**.

## Publish

A folder:

```sh
npx agent-paste publish ./report
```

A single file (treated as a one-file **Artifact**):

```sh
npx agent-paste publish ./report.html
```

With a custom retention TTL:

```sh
npx agent-paste publish ./report --ttl 7d
```

## Management

The current MVP API exposes publish and repo-local admin verbs:

| Command                                           | Purpose                                                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `agent-paste whoami`                              | Show the resolved **Workspace**, actor, and granted **Scopes**.                                  |
| `agent-paste publish <path>`                      | Walk a local file or directory, upload bytes, finalize, and print the published Artifact result. |
| `agent-paste admin workspace create <email>`      | Create a local/dev Workspace.                                                                    |
| `agent-paste admin workspace list`                | List local/dev Workspaces.                                                                       |
| `agent-paste admin key create <workspace-id>`     | Create a local/dev API Key.                                                                      |
| `agent-paste admin key revoke <api-key-id> --yes` | Revoke a local/dev API Key.                                                                      |
| `agent-paste admin artifact list/get/delete`      | Inspect or delete local/dev Artifacts; delete requires `--yes`.                                  |
| `agent-paste admin cleanup run`                   | Run cleanup in a local/dev harness; mutating cleanup requires `--yes`.                           |
| `agent-paste admin events list`                   | List operation events in a local/dev harness.                                                    |

## Flags

| Flag                   | Purpose                                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `--title <text>`       | Set **Display Metadata** title. Default: path basename.                                                          |
| `--entrypoint <path>`  | Override the inferred **Entrypoint**. Must be a file inside the upload.                                          |
| `--render-mode <mode>` | Override the inferred **Render Mode**. First-slice modes: `html`, `markdown`, `text`, `image`, `audio`, `video`. |
| `--ttl <duration>`     | Set Artifact retention for `publish`. Accepts `30m`, `12h`, `7d`, or seconds, subject to workspace caps.         |
| `--json`               | Emit the **Publish Result** as JSON on stdout. Stdout becomes pure JSON.                                         |
| `--quiet`              | Suppress human-readable stdout output.                                                                           |

## Repo-local admin harness

Local operators can point `AGENT_PASTE_ADMIN_URL` at a dev API/admin worker and use:

```sh
pnpm cli:dev admin workspace create agent@example.com --name "Local Agent Paste"
pnpm cli:dev admin workspace list --json
pnpm cli:dev admin key create <workspace-id> --name "local harness"
pnpm cli:dev admin artifact list --json
pnpm cli:dev admin cleanup run --dry-run --json
pnpm cli:dev admin events list --json
```

Admin commands use the same bearer credential resolution as the rest of the CLI. Do not pass operator credentials as flags.

## Output

Default human-readable output:

```
Published artifact art_01H... revision rev_01H...

  Revision:   https://app.agent-paste.sh/al/AB3CDEFGHJKLMN56#AQEAAAGJk2YA...
  Private:    https://app.agent-paste.sh/artifacts/art_01H...
  Agent View: https://api.agent-paste.sh/v1/artifacts/art_01H.../agent-view
  Bundle:     pending
```

With `--share`, the output also lists the **Share Link**. If the publish attached **Safety Warnings**, they appear at the bottom under a `Safety:` header. Asynchronous Safety Warnings created after publish are not visible here; fetch the **Agent View** to see them.

With `--json`, stdout is exactly the Publish Result:

```json
{
  "artifact_id": "art_01H...",
  "revision_id": "rev_01H...",
  "title": "report",
  "view_url": "https://api.agent-paste.sh/v1/public/agent-view/...",
  "agent_view_url": "https://api.agent-paste.sh/v1/public/agent-view/...",
  "expires_at": "2026-06-20T00:00:00.000Z"
}
```

## Inference

- **Entrypoint** for a folder is the first match of `index.html`, `index.md`, `README.md`, or the single file if the folder contains exactly one. Otherwise publish fails; pass `--entrypoint`.
- **Render Mode** is inferred from the Entrypoint extension. Override with `--render-mode`.

## Excluded by default

The CLI silently excludes these from any folder upload and prints the excluded set to stderr:

- `.git/`
- `.DS_Store`
- `node_modules/`
- `.env`, `.env.*`

The exclusion list is not configurable in v1. If you need one of these in the upload, build a folder without it.

## Idempotency and retries

The CLI generates an **idempotency key** per `publish` invocation and reuses it across automatic retries. The API deduplicates retried calls, so transient network failures cannot produce duplicate Artifacts or Revisions.

Transient failures (network errors, 5xx, 504, 429 with `Retry-After`) are retried up to 3 times with 1s/2s/4s backoff. Non-transient failures (4xx) exit immediately. An expired **Upload Session** exits cleanly; re-run `publish` to start over.

## Errors

Exit `0` for success, `1` for any failure. Plain text on stderr:

```
agent-paste: not authenticated. Run `agent-paste login` or set AGENT_PASTE_API_KEY
```

For interactive users, the equivalent fix is:

```sh
npx agent-paste login
```

With `--json`, errors are structured on stderr:

```json
{
  "error": {
    "code": "insufficient_scope",
    "message": "Actor has scopes [write], needs [write, read, share]",
    "docs": "https://agent-paste.sh/docs/scopes"
  }
}
```

The `code` field is the stable identifier; `message` is human-readable.

## When not to use the CLI

The CLI assumes `npx` is available. For non-Node environments (Python or Go agents, server-to-server callers, sandboxes without npm access), use the public REST API directly at `https://api.agent-paste.sh/v1`. Lower-level **Upload Session** endpoints are public and documented in the OpenAPI spec.

Hosted agent products that support MCP can use the OAuth-only MCP server at `https://mcp.agent-paste.sh`. MCP is intentionally text-only for publish/update operations; binary and multi-file **Artifacts** remain CLI/REST territory.
