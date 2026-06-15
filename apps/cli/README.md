# @zaks-io/agent-paste

The command-line interface for [Agent Paste](https://agent-paste.sh) -- where
agents publish. Point it at a file or folder your agent just built and get back
a hosted **Artifact** with a URL you can open and share. No deploy, no repo, no
bucket. Built for agents and CI, usable by hand.

```sh
npx @zaks-io/agent-paste login    # once, in a browser
npx @zaks-io/agent-paste publish ./report
```

```text
✓ Published "report"

  View      https://app.agent-paste.sh/v/art_01H...
  Expires   2026-06-20
  Upload    3/3 uploaded, 0 reused · 42 KB sent, 0 B cached

  Update    npx @zaks-io/agent-paste publish ./report --artifact-id art_01H...
            (revises this Artifact; same link live-updates the open page)

  → open https://app.agent-paste.sh/v/art_01H...
```

The npm package is `@zaks-io/agent-paste`; the installed binary is `agent-paste`.
Examples use `npx @zaks-io/agent-paste ...` for one-shot Node runs and
`agent-paste ...` after installation; both execute the same CLI.
If your agent host cannot run a CLI but can connect to remote MCP, use the
hosted MCP server instead: [`https://mcp.agent-paste.sh`](https://mcp.agent-paste.sh).
See [`docs/mcp.md`](../../docs/mcp.md).

## Install

### npm (Node.js 24+)

No install required:

```sh
npx @zaks-io/agent-paste publish <path>
```

For repeated use:

```sh
npm install -g @zaks-io/agent-paste
```

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

## Authenticate

For interactive use, sign in through your browser. `login` runs a loopback PKCE
flow and stores the resulting scoped local credential in the OS keyring (macOS
Keychain, Windows Credential Manager, or Linux Secret Service). If no keyring is
available, it falls back to `~/.config/agent-paste/credentials.json` at mode
`0600` and prints a warning.

```sh
agent-paste login
agent-paste logout
```

The stored credential is capped at `publish` and `read`, expires after 90 days,
and never grants admin. The CLI never accepts secrets as flags.

## Publish

A folder:

```sh
npx @zaks-io/agent-paste publish ./report
```

A single file:

```sh
npx @zaks-io/agent-paste publish ./report.html
```

A new revision of an existing Artifact:

```sh
npx @zaks-io/agent-paste publish ./report --artifact-id art_01H...
```

Artifact lifetime is server-side Workspace/Plan policy. The CLI does not accept
a retention flag.

### URL model

The URL model has three distinct URL types:

```text
Private Link          https://app.agent-paste.sh/v/{artifact_id}
Access Link Signed URL https://app.agent-paste.sh/al/{publicId}#{blob}
Revision Content URL  https://usercontent.agent-paste.sh/v/{content_token}/index.html
```

A **Private Link** is the login-walled clean viewer at `/v/{artifact_id}` for a
Workspace Member, and is the `View` URL publish prints. (The dashboard-only
Artifact Console at `/artifacts/{artifact_id}` is a management page, never the
publish handoff.) An **Access Link Signed URL** minted from a **Share Link** is an
unlisted no-login URL that follows the latest Published Revision. A
**Revision Content URL** is a signed Content Origin URL for one exact Revision;
it expires, does not Live Update, and direct `usercontent` HTML is inert.

Publish is **content-only and private**: it returns one link, the `private_url`
Private Link, and prints it as `View`. There is no `--share` flag. To make an
Artifact reachable without login, run
`agent-paste set-visibility <artifact-id> unlisted` as a separate step; it mints
or reuses the one Share Link and prints `unlisted_url`. To remove no-login access,
run `agent-paste set-visibility <artifact-id> private`.

## Ephemeral publish fallback

Before using `--ephemeral`, agents should check for an existing login:

```sh
npx @zaks-io/agent-paste whoami --json
```

`whoami` exits `0` whether or not you are signed in - being anonymous is a valid
answer, not a failure. Do not branch on the exit code; check the JSON:
`{"authenticated": false}` means no usable credential, while a signed-in
response carries the resolved Workspace, actor, and scopes.

If `whoami` reports you are signed in, publish normally without `--ephemeral`.
If not and interactive auth is possible, run `agent-paste login` first. Use
`--ephemeral` only when no login is available, or when the user explicitly asks
for accountless publish. The CLI self-provisions a short-lived **Workspace**,
publishes, and prints a one-time **Claim Token** as a claim link. Use this path
for non-interactive work such as text, markdown, images, and static HTML/CSS.

```sh
npx @zaks-io/agent-paste publish ./report --ephemeral
```

`--ephemeral` ignores any stored login credential or environment-provided
credential. It is a restricted tier for unclaimed work, not the Free Plan. The
Artifact lives for at most **24 hours** (the ephemeral TTL ceiling) and then
auto-deletes. To keep it, a signed-in human opens the claim link to reparent the
Artifact into their Personal Workspace.

The Claim Token rides the URL **hash** only (`/claim#<token>`): never the query string, and never the `private_url`, `revision_content_url`, or `agent_view_url`. The claim link points at `AGENT_PASTE_WEB_URL` (default `https://app.agent-paste.sh`).

Ephemeral content uses the script-disabled execution policy while unclaimed.
Text, markdown, images, and static HTML/CSS render, but JavaScript, inline event
handlers, and `.js` assets do not execute. After claim, newly minted viewer URLs
can run interactive HTML inside the controlled Artifact Viewer. For an
interactive page, browser app, or visualization that needs JavaScript, publish
from a signed-in Workspace instead of passing `--ephemeral`.

## Commands

| Command                                                        | Purpose                                                                                                  |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `agent-paste help publish`                                     | Agent-oriented publish guide with mode choices, recipes, and JSON fields.                                |
| `agent-paste login`                                            | Sign in through browser loopback auth and store a scoped local credential.                               |
| `agent-paste logout`                                           | Revoke the stored credential when possible, then remove it locally.                                      |
| `agent-paste whoami`                                           | Show the resolved **Workspace**, actor, and granted scopes.                                              |
| `agent-paste publish <path>`                                   | Walk a local file or directory, upload bytes, finalize, and print the result (content-only and private). |
| `agent-paste pull <artifact-id> <path>`                        | Read one stored file's content back from an Artifact.                                                    |
| `agent-paste edit <artifact-id> <path>`                        | Apply literal find/replace edits to one stored file, then publish a new Revision under the same link.    |
| `agent-paste set-visibility <artifact-id> <private\|unlisted>` | Change Artifact visibility. `unlisted` returns `unlisted_url`; `private` revokes active Access Links.    |
| `agent-paste version`                                          | Print the CLI version baked in at build time.                                                            |
| `agent-paste upgrade [<tag>]`                                  | Self-update a standalone binary install: download, verify, and replace in place.                         |

## Flags

| Flag                     | Purpose                                                                                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--artifact-id <id>`     | Publish a new revision of an existing Artifact instead of creating a new one.                                                                              |
| `--title <text>`         | Set the title. Default: path basename.                                                                                                                     |
| `--entrypoint <path>`    | Override the inferred entrypoint. Must be a file inside the upload.                                                                                        |
| `--render-mode <mode>`   | Override the inferred render mode: `html`, `markdown`, `text`, `image`, `audio`, `video`.                                                                  |
| `--ephemeral`            | Restricted accountless fallback for non-interactive text/images/static output. Ignores stored login and environment credentials, then prints a claim link. |
| `--revision-id <id>`     | With `pull`, read a specific Revision instead of the latest published Revision.                                                                            |
| `--edits <file>`         | With `edit`, read the JSON edit array from a file instead of stdin.                                                                                        |
| `--json`                 | Emit the result as JSON on stdout. Stdout becomes pure JSON and carries a stable `schema_version`.                                                         |
| `--quiet`                | Suppress human-readable stdout output.                                                                                                                     |
| `--color` / `--no-color` | Force rich or plain output. Default: rich on a TTY, plain when piped or when `NO_COLOR` or `CI` is set.                                                    |

## Output

Default human-readable output is shown in the quick start above. With `--json`,
stdout is exactly the publish result:

```json
{
  "schema_version": "1",
  "artifact_id": "art_01H...",
  "revision_id": "rev_01H...",
  "title": "report",
  "private_url": "https://app.agent-paste.sh/v/art_01H...",
  "revision_content_url": "https://usercontent.agent-paste.sh/v/...",
  "agent_view_url": "https://api.agent-paste.sh/v1/public/agent-view/...",
  "expires_at": "2026-06-20T00:00:00.000Z",
  "bundle": {
    "status": "pending",
    "retry_after_seconds": 5
  },
  "upload_stats": {
    "total_files": 3,
    "total_bytes": 42000,
    "uploaded_files": 3,
    "uploaded_bytes": 42000,
    "reused_files": 0,
    "reused_bytes": 0
  }
}
```

`private_url` is the login-walled `/v/{artifact_id}` clean viewer for Workspace
members and the default `View` URL. Publish is content-only and private, so the
result carries no `shared` field and no `access_link_url`; no-login sharing is
the separate `agent-paste set-visibility <artifact-id> unlisted` step, which
prints the Share Link's `unlisted_url`.
`revision_content_url` is served from the isolated content origin
(`usercontent.agent-paste.sh`), is signed for the returned `revision_id`, and
does not Live Update; direct HTML opened there is raw/inert byte delivery, not
the product viewer. `agent_view_url` is the Agent View JSON on the API origin.
In Agent View, each file's signed content URL is `files[].url`; there is no
`content_url` field. Do not verify a `private_url` with HTTP status alone:
unauthenticated HTTP clients may receive the app shell or sign-in redirect state
with HTTP 200. Use `set-visibility <artifact-id> unlisted` for no-login browser
verification, or Agent View `files[].url` entries for machine verification.
`bundle` reports whether the revision archive is pending, ready, failed, or disabled.

With `--json`, `set-visibility <artifact-id> unlisted` emits:

```json
{
  "schema_version": "1",
  "artifact_id": "art_01H...",
  "visibility": "unlisted",
  "access_link_id": "al_01H...",
  "unlisted_url": "https://app.agent-paste.sh/al/0123456789ABCDEF#..."
}
```

With `--json`, `set-visibility <artifact-id> private` emits:

```json
{
  "schema_version": "1",
  "artifact_id": "art_01H...",
  "visibility": "private",
  "private_url": "https://app.agent-paste.sh/v/art_01H...",
  "revoked_access_link_ids": ["al_01H..."]
}
```

With `--ephemeral`, human-readable output leads with the claim link — the URL to
open, keep, and unlock the Artifact. The `private_url` clean viewer appears as
`View (works after claiming)`:

```text
Open this to view, keep, and unlock your artifact:
  Claim    https://app.agent-paste.sh/claim#ap_ct_...
  Expires  2026-06-13

  View     https://app.agent-paste.sh/v/art_01H... (works after claiming)

  → open https://app.agent-paste.sh/claim#ap_ct_...
```

Agents should relay the claim link to the user, not the `private_url`.

With `--json` and `--ephemeral`, the result also carries `claim_token`, `claim_url`, `workspace_id`, `api_key_id`, and `claim_token_id`.

## Pull and edit

`pull` reads one stored file back so an agent can inspect or edit against the
current bytes:

```sh
agent-paste pull art_01H... index.html > index.html
agent-paste pull art_01H... index.html --revision-id rev_01H... --json
```

Plain `pull` writes the text body to stdout. Binary or too-large files are not
printed raw; use `--json` for metadata and fetch their bytes through the content
URL if needed. `--quiet` does not suppress the file body because the body is the
command result.

`edit` applies the same literal find/replace shape as MCP `multi_edit`, then
publishes a new Revision under the same stable Artifact link:

```sh
printf '[{"old_string":"old","new_string":"new"}]' |
  agent-paste edit art_01H... index.html --json

agent-paste edit art_01H... index.html --edits edits.json --json
```

Each `old_string` must match the current file exactly once unless
`replace_all: true` is set. A non-matching or ambiguous edit fails loudly; pull
the file first to get the exact base text.

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

## Idempotency

The CLI generates an **idempotency key** per `publish` invocation and sends it on every mutating call (session create, finalize, publish), so a duplicated or replayed request within one invocation cannot double-apply on the server. The CLI does not retry failed requests itself; a failure exits nonzero (see exit codes below) and callers decide whether to re-run. An expired upload session exits cleanly; re-run `publish` to start over.

## Errors and exit codes

Exit codes are stable so scripts can branch without parsing messages:

| Code | Name             | Cause                                                                |
| ---- | ---------------- | -------------------------------------------------------------------- |
| 0    | success          | command completed                                                    |
| 1    | generic          | any other failure, or a 4xx outside the buckets below                |
| 2    | auth             | HTTP 401/403 (e.g. `not_authenticated`)                              |
| 3    | quota            | HTTP 429 — rate limits and write-allowance; back off before retrying |
| 4    | validation       | HTTP 400/422                                                         |
| 5    | not found        | HTTP 404                                                             |
| 6    | network / server | HTTP 5xx                                                             |

Errors go to **stderr**. Human-readable mode prints `✗ <code> — <message>`,
where `<code>` is the stable error code:

```text
✗ not_authenticated — Run agent-paste login or use --ephemeral for an accountless handoff.
```

With `--json`, stderr carries a JSON
error envelope instead: `{"error": {"code", "message", "docs?"}}`. The full
output contract lives in [`docs/specs/cli.md`](../../docs/specs/cli.md).

## Configuration

| Variable                      | Purpose                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `AGENT_PASTE_API_URL`         | Override the API base URL. Defaults to `https://api.agent-paste.sh`.                                                |
| `AGENT_PASTE_WEB_URL`         | Override the web app base URL used to build the `--ephemeral` claim link. Defaults to `https://app.agent-paste.sh`. |
| `AGENT_PASTE_NO_UPDATE_CHECK` | Set to any value to disable the background update check entirely.                                                   |

## Staying up to date

After a real command (not `help`/`version`), the CLI checks at most once per 24h whether a newer version has been published and prints a single hint to **stderr**. It is silent in CI, with `--json`, with `--quiet`, on a non-TTY, and when `AGENT_PASTE_NO_UPDATE_CHECK` is set; a network failure is swallowed and never affects the command's result or exit code. The hint is tailored to how you installed it:

- **Standalone binary** → `agent-paste upgrade`. This downloads the matching release asset from GitHub, verifies it against `SHA256SUMS`, and atomically replaces the running binary in place. Pin a specific release with `agent-paste upgrade cli-v1.2.3`. If the install directory is not writable by your user (a `sudo`-installed binary), the verified download is left staged and the CLI prints the exact `sudo mv` to finish.
- **`npm i -g`** → `npm i -g @zaks-io/agent-paste@latest`.
- **`npx`** → nothing; `npx` already runs the latest published version.

## When not to use the CLI

The CLI runs either as a standalone binary (the installer above, no Node) or via
Node/`npx`. For hosted agents that cannot run either form of the CLI, connect to
the OAuth MCP server at `https://mcp.agent-paste.sh`.
