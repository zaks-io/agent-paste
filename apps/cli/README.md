# @zaks-io/agent-paste

Command-line interface for publishing shareable **Artifacts** to [Agent Paste](https://agent-paste.sh). Point it at a file or folder and it uploads the bytes, finalizes a revision, and prints a shareable URL. Built for agents and CI, usable by hand.

The npm package is `@zaks-io/agent-paste`; the installed binary is `agent-paste`.

## Install

### Standalone binary (no Node required)

macOS and Linux:

```sh
curl -fsSL https://agent-paste.sh/install.sh | sh
```

Windows (PowerShell):

```powershell
irm https://agent-paste.sh/install.ps1 | iex
```

This downloads the prebuilt binary for your OS/arch, verifies it against the release `SHA256SUMS`, sets the exec bit, and installs to `~/.local/bin/agent-paste` (no sudo). On Windows it installs to `%LOCALAPPDATA%\agent-paste\bin` and updates your user `PATH`.

Overrides (env vars): `AGENT_PASTE_VERSION` pins a release tag (e.g. `cli-v0.1.0`; default `latest`), `AGENT_PASTE_INSTALL_DIR` changes the install directory.

The macOS binary is codesigned and notarized. Prefer manual verification? Download the asset and `SHA256SUMS` from the [releases page](https://github.com/zaks-io/agent-paste/releases) and run `shasum -a 256 -c SHA256SUMS`, then `chmod +x` the binary yourself.

### npm (Node.js 24+)

No install required:

```sh
npx @zaks-io/agent-paste publish <path>
```

For repeated use:

```sh
npm install -g @zaks-io/agent-paste
```

## Authenticate

For interactive use, sign in through your browser. `login` runs a loopback PKCE flow, mints a scoped **API Key**, and stores it in the OS keyring (macOS Keychain, Windows Credential Manager, or Linux Secret Service). If no keyring is available, it falls back to `~/.config/agent-paste/credentials.json` at mode `0600` and prints a warning.

```sh
agent-paste login
agent-paste logout
```

The minted key is capped at `publish` and `read`, expires after 90 days, and never grants admin.

For CI and headless agents, set `AGENT_PASTE_API_KEY` instead:

```sh
export AGENT_PASTE_API_KEY=ap_pk_...
```

`AGENT_PASTE_API_KEY` takes precedence over a stored login credential; when both are present the CLI prints a one-line note to stderr naming which it used. The CLI never accepts secrets as flags. API Keys encode their **Workspace**.

## Publish

A folder:

```sh
npx @zaks-io/agent-paste publish ./report
```

A single file:

```sh
npx @zaks-io/agent-paste publish ./report.html
```

With a custom retention TTL:

```sh
npx @zaks-io/agent-paste publish ./report --ttl 7d
```

A new revision of an existing Artifact:

```sh
npx @zaks-io/agent-paste publish ./report --artifact-id art_01H...
```

## Publish without signing in

For agents with no human auth, `--ephemeral` skips login entirely. The CLI self-provisions a short-lived **Workspace** and key, publishes, and prints a one-time **Claim Token** as a claim link.

```sh
npx @zaks-io/agent-paste publish ./report --ephemeral
```

`--ephemeral` ignores `AGENT_PASTE_API_KEY` and any stored login credential (it prints a one-line note to stderr when it does). The Artifact lives for at most **24 hours** (the ephemeral TTL ceiling) and then auto-deletes. To keep it, a signed-in human opens the claim link to reparent the Artifact into their Personal Workspace.

The Claim Token rides the URL **hash** only (`/claim#<token>`): never the query string, and never the `view_url` or `agent_view_url`. The claim link points at `AGENT_PASTE_WEB_URL` (default `https://app.agent-paste.sh`).

## Commands

| Command                      | Purpose                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------- |
| `agent-paste login`          | Mint a publish/read API key via browser loopback login.                       |
| `agent-paste logout`         | Revoke the stored API key when possible, then remove the local credential.    |
| `agent-paste whoami`         | Show the resolved **Workspace**, actor, and granted scopes.                   |
| `agent-paste publish <path>` | Walk a local file or directory, upload bytes, finalize, and print the result. |

## Flags

| Flag                   | Purpose                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------- |
| `--artifact-id <id>`   | Publish a new revision of an existing Artifact instead of creating a new one.                           |
| `--title <text>`       | Set the title. Default: path basename.                                                                  |
| `--entrypoint <path>`  | Override the inferred entrypoint. Must be a file inside the upload.                                     |
| `--render-mode <mode>` | Override the inferred render mode: `html`, `markdown`, `text`, `image`, `audio`, `video`.               |
| `--ttl <duration>`     | Set retention. Accepts `30m`, `12h`, `7d`, or seconds, subject to workspace caps.                       |
| `--ephemeral`          | Publish with no login or key. Self-provisions a short-lived Workspace and prints a one-time claim link. |
| `--json`               | Emit the result as JSON on stdout. Stdout becomes pure JSON.                                            |
| `--quiet`              | Suppress human-readable stdout output.                                                                  |

## Output

Default human-readable output:

```text
Published artifact art_01H... revision rev_01H...

  Title:      report
  View:       https://usercontent.agent-paste.sh/v/...
  Agent View: https://api.agent-paste.sh/v1/public/agent-view/...
  Expires:    2026-06-20T00:00:00.000Z
```

With `--json`, stdout is exactly the publish result:

```json
{
  "artifact_id": "art_01H...",
  "revision_id": "rev_01H...",
  "title": "report",
  "view_url": "https://usercontent.agent-paste.sh/v/...",
  "agent_view_url": "https://api.agent-paste.sh/v1/public/agent-view/...",
  "expires_at": "2026-06-20T00:00:00.000Z"
}
```

`view_url` is served from the isolated content origin (`usercontent.agent-paste.sh`);
`agent_view_url` is the Agent View JSON on the API origin.

With `--ephemeral`, the human-readable output appends the claim link:

```text
Open the claim link in a browser while signed in. The token lives in the URL hash only (never the query string).
  Claim:      https://app.agent-paste.sh/claim#ap_ct_...
```

With `--json` and `--ephemeral`, the result also carries `claim_token`, `claim_url`, `workspace_id`, `api_key_id`, and `claim_token_id`.

## Inference

- **Entrypoint** for a folder is the first match of `index.html`, `index.md`, `README.md`, or the single file if the folder contains exactly one. Otherwise publish fails; pass `--entrypoint`.
- **Render mode** is inferred from the entrypoint extension. Override with `--render-mode`.

## Excluded by default

The CLI excludes these from any folder upload and prints the excluded set to stderr:

- `.git/`
- `.DS_Store`
- `node_modules/`
- `.env`, `.env.*`

The exclusion list is not configurable. If you need one of these in the upload, build a folder without it.

## Idempotency and retries

The CLI generates an **idempotency key** per `publish` invocation and reuses it across automatic retries, so transient network failures cannot produce duplicate Artifacts or Revisions. Transient failures (network errors, 5xx, 429 with `Retry-After`) are retried up to 3 times with 1s/2s/4s backoff. Non-transient failures (4xx) exit immediately. An expired upload session exits cleanly; re-run `publish` to start over.

## Errors

Exit `0` for success, `1` for any failure. Plain text on stderr:

```text
agent-paste: not_authenticated: Set AGENT_PASTE_API_KEY or pass an auth provider.
```

With `--json`, errors are structured on stderr:

```json
{
  "error": {
    "code": "insufficient_scope",
    "message": "Actor has scopes [read], needs [publish, read]"
  }
}
```

The `code` field is the stable identifier; `message` is human-readable.

## Configuration

| Variable              | Purpose                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `AGENT_PASTE_API_KEY` | API key for CI and headless use. Takes precedence over stored login.                                                |
| `AGENT_PASTE_API_URL` | Override the API base URL. Defaults to `https://api.agent-paste.sh`.                                                |
| `AGENT_PASTE_WEB_URL` | Override the web app base URL used to build the `--ephemeral` claim link. Defaults to `https://app.agent-paste.sh`. |

## When not to use the CLI

The CLI runs either as a standalone binary (the installer above, no Node) or via Node/`npx`. For server-to-server callers and environments where neither fits (Python or Go agents, sandboxes without a shell or filesystem), call the REST API directly at `https://api.agent-paste.sh/v1`.
