# CLI output contract

The `agent-paste` CLI serves both humans at a terminal and machines (agents, CI,
scripts). This spec is the source of truth for how it renders output and signals
failure. Command behavior itself is in [`features.md`](./features.md); this
document owns the cross-command output contract.

## Authentication

The CLI accepts a Workspace API key through `AGENT_PASTE_API_KEY` or a saved
credential created by `agent-paste login`. Both authenticate CLI requests with
an API key bearer. Browser login is an alternative way to obtain that key.

Create a key in the dashboard's [Keys page](https://app.agent-paste.sh/keys),
then inject it through your shell, CI, or sandbox secret configuration as
`AGENT_PASTE_API_KEY`. Keep it out of command arguments, source files, logs,
and published content. Provisioned sandboxes can already have this variable;
use the inherited environment without another login.

A non-empty `AGENT_PASTE_API_KEY` takes precedence over saved login credentials.
An empty variable is treated as absent. A rejected, revoked, expired, or
wrong-environment key fails with an authentication error and exit code `2`;
the CLI does not retry with the saved credential. Correct the key configuration
or deliberately unset it to use saved login. `AGENT_PASTE_API_URL` and
`AGENT_PASTE_UPLOAD_URL` select alternate service endpoints; the key must belong
to that environment.

`agent-paste whoami --json` verifies the selected credential with the API and
returns `authenticated: true` plus Workspace, actor, and scopes from CLI 0.2.6
onward. CLI 0.2.5
and older omit `authenticated` on success; successful metadata still means the
credential is valid. The added boolean keeps JSON schema version `2`.
When no usable local credential exists,
it returns `authenticated: false` with exit code `0` without an API request.
A configured credential that the API rejects produces an error, not this
signed-out result. Network failures also fail the command.

## Login

`agent-paste login` uses browser OAuth with a loopback PKCE callback on the
machine running the CLI. `agent-paste login --device-code` uses the
[WorkOS Connect device authorization flow](https://workos.com/docs/reference/workos-connect/cli-auth)
for sandboxes and remote shells. It prints a verification URL and user code to
stderr, then waits while the human approves that code in their own browser.
Device login does not start a browser or listen on a local port.

Both flows exchange the WorkOS access token for the existing publish/read CLI
credential through `/v1/web/keys` and save it through the same credential store.
The device code and OAuth tokens are never printed or persisted. Login
instructions remain on stderr, including with `--json`; use `whoami --json`
after successful login to inspect the authenticated state.

Device login respects the provider's polling interval, increases it by five
seconds on `slow_down`, and stops on denial, expiry, malformed responses, or
other errors. It bounds network requests and stops polling when the device
code expires. The user can start a fresh login after expiry.

The device authorization endpoint defaults to
`${AGENT_PASTE_WORKOS_BASE_URL}/oauth2/device_authorization`, using the same
AuthKit domain and public client as browser login.
`AGENT_PASTE_WORKOS_DEVICE_AUTHORIZATION_URL` overrides that endpoint for
alternate environments. Token exchange uses the existing token URL override.

### Agent authentication decisions

- Start with `whoami --json` in the inherited environment. If authenticated,
  publish directly. An injected API key needs no browser or device login.
- If the command fails, diagnose the configured credential or network. Do not
  silently start a login or switch to ephemeral publishing.
- If it exits `0` with `authenticated: false`, supply an API key or use `login`
  locally or `login --device-code` in a sandbox. Keep device login running while
  the human approves the URL and user code from stderr, then check `whoami`
  again. Login saves a credential but does not replace an environment key.
- If authentication is unavailable, report the blocker or use `--ephemeral`
  when accountless static output meets the task or is explicitly requested.
  That flag ignores both the environment key and saved login. MCP requires
  OAuth and shell-less host support; it does not accept API keys.

## Logout

`agent-paste logout` attempts to revoke the saved login credential on the server,
then removes it locally. If revocation fails, it warns on stderr and still
removes the local credential. An expired saved credential is removed locally
without a revocation request. No saved credential returns
`{ status: "no_credential" }`.

Logout never unsets or revokes `AGENT_PASTE_API_KEY`. Subsequent commands still
use that key. Unset it to stop using it in the current shell; revoke it in the
dashboard's Keys page when it should no longer work anywhere.

## Feedback

`agent-paste feedback "<body>"` reports product friction through `POST /v1/feedback`.
Without a body argument, it reads UTF-8 text from piped stdin. At an interactive
terminal, omitting the body fails immediately. The trimmed body must contain
1 to 10,000 characters. Quote a body with spaces as one argument. Put `--`
before a body that begins with `--`, after any output flags.

```sh
agent-paste feedback "Upload retry failed" --json
cat report.txt | agent-paste feedback --json
```

Feedback reuses the current environment or saved login credential. Any
authenticated credential can submit, including a `read`-only credential.
The CLI attaches `version`, `surface: "cli"`, and `command: "feedback"`;
it never stores raw command arguments or credentials in context.

Rich and plain output confirm submission without echoing the body or context.
`--quiet` suppresses confirmation. `--json` returns
`{ "feedback_id": "fb_...", "schema_version": "2" }` on stdout. Errors go to
stderr. Validation errors exit `4`, authentication errors `2`, rate limits `3`,
transport failures `1`, and HTTP server failures `6`, as in the exit-code table.

## Output modes

Every command resolves to exactly one of three render modes. Selection is
automatic; flags override detection.

| Mode    | Selected when                                                        | What stdout carries                             |
| ------- | -------------------------------------------------------------------- | ----------------------------------------------- |
| `rich`  | stdout is a TTY and color is not suppressed                          | Colour, in-place upload spinner, clickable URLs |
| `plain` | not a TTY, or `NO_COLOR` / `CI` set, or `TERM=dumb`, or `--no-color` | Same layout as rich, ANSI stripped, no spinner  |
| `json`  | `--json`                                                             | A single JSON object, nothing else              |

- `--color` forces `rich`; `--no-color` forces `plain`. `--json` always wins.
- `rich` and `plain` render the **same layout** — `plain` is `rich` with the
  escape codes removed and the carriage-return spinner suppressed, so piping or
  redirecting never corrupts a log.
- Clickable URLs in `rich` use OSC 8 hyperlinks; the visible text is the raw URL
  so it stays copy-pasteable. They degrade to bare URLs in `plain`/`json`.

## Channel discipline

- **stdout is the result channel.** In `json` mode it contains only the JSON
  object — no progress, no diagnostics, no banners.
- **stderr is the diagnostic channel.** Progress spinners, credential-precedence
  notes, the update-check nudge, and error output all go to stderr. This keeps
  `... --json | jq` and `... > out.json` clean.
- `--quiet` suppresses the human summary on stdout. Errors and the exit code
  still apply. `--quiet --json` still prints the JSON object (the object is the
  point of `--json`); `--quiet` without `--json` prints nothing on success. The
  exception is `pull`, whose file body _is_ the result (cat-like), so `--quiet`
  never suppresses it — otherwise `pull … --quiet > file` would write an empty file.

## Artifact URLs

Use the artifact ID, such as `01234-56789-abcde-fghjd`, with
`publish <path> --artifact-id <artifact-id>`, `pull <artifact-id> <remote-path>`,
or `edit <artifact-id> <path>`. Full URLs also work. Existing `art_...` IDs
remain supported. Workspace authorization still applies.

The server resolves the hostname in the current environment. A file path,
query, or fragment on the URL does not select a different Artifact. The
`remote-path` or `path` argument still selects the file. Foreign hosts,
credentials in URLs, explicit ports, and URLs from another environment fail.
A bare subdomain such as `dzd5k-mdx2y-6hbn2-ptnh6` resolves in the current
environment. A copied label with an environment suffix, such as
`dzd5k-mdx2y-6hbn2-ptnh6-preview`, must match that environment. Bare IDs are
case-insensitive and use the same checksum validation as Artifact URLs.
Structured output continues to return canonical `artifact_id` values.

## JSON contract

- Every JSON payload carries a top-level `schema_version` string. The current
  version is `"2"`. Consumers should branch on it; new fields may be added
  within a version, but field removals or renames bump it.
- Object payloads are emitted as `{ "schema_version": "2", ...fields }`.
- `publish --json` emits `{ schema_version, artifact_id, revision_id, title,
url, expires_at, mode, no_change, retention, effective_expires_at, changes, upload_stats }`. `url` is the no-login top-level capability
  website and is the only recipient link. Revising with `--artifact-id` keeps
  it unchanged. `upload_stats` is `{ total_files, total_bytes, uploaded_files,
uploaded_bytes, reused_files, reused_bytes }`.
- Guarded publish opts into retention fields. Its JSON result adds `mode`,
  `no_change`, `retention`, `effective_expires_at` and `changes` within schema
  version `"2"`. Retrying a saved transfer reuses the same operation keys and
  recovers the authoritative publish result through idempotent replay.
- There is no `--share`, visibility input, private viewer, or second sharing
  command.
- `publish --ephemeral --json` emits the normal publish fields plus
  `{ claim_token, claim_url, workspace_id, api_key_id, claim_token_id }`. When the caller supplies
  `--claim-code <clm_...>`, the API embeds it in the claim token; the CLI never
  returns `claim_code` as a separate field.
- `pull <artifact-id> <remote-path> [--revision-id <id>]` reads one stored file back
  ([ADR 0090](../adr/0090-agent-file-read-back-api-decrypts-member-plaintext.md)).
  `<remote-path>` is relative to the Artifact root, not a local destination.
  Default output is cat-like (the raw text body to stdout, so
  `pull <artifact-id> index.html > ./index.html` works); `--json` emits
  `{ schema_version, path, sha256, size_bytes, content_type, is_binary, url, body? }`. A binary
  file has no inline body: `--json` reports `is_binary: true` with no `body` and
  includes the signed exact-Revision `url`; plain mode errors because raw bytes
  would corrupt the stream. An oversize text file likewise has no `body`; fetch
  it from `url`. The CLI resolves Agent View first and pins the content read to
  that returned `revision_id`, so the body, metadata, and URL cannot cross a
  concurrent latest-Revision update.
- `edit <artifact-id> <path>` applies literal find/replace edits to one stored
  file and publishes the result as a new Revision of the same Artifact (the
  parity twin of the MCP `multi_edit` tool; see [the edit verb](#edit-literal-findreplace-revise)).
  It emits the same JSON as a successful `publish` (the new Revision's
  `url`, `artifact_id`, `upload_stats`, …). When the edits reproduce the
  stored bytes byte-for-byte it is a no-op: `--json` emits `{ schema_version,
artifact_id, noop: true, title, url }` and nothing is published.

## Edit (literal find/replace revise)

`edit <artifact-id> <path> [--edits <file>] [--json]` is a one-file, in-place
revise that mirrors the MCP `multi_edit` tool ([ADR 0091](../adr/0091-client-side-revise-engine-and-literal-edit-tools.md)).
Both surfaces share one engine (`reviseOnePath` in `@agent-paste/revise-core`):
the CLI reads the stored file, applies the edits client-side, and publishes the
result as a new Revision under the unchanged Artifact id, so the stable link
shows the new Revision on refresh instead of stranding it on a new Artifact.

Edits are a JSON array of `{ old_string, new_string, replace_all? }`, the same
shape as Claude's Edit tool, read from `--edits <file>` or stdin (1–100 edits,
applied in order, each seeing the previous result). Choosing JSON over
positional `--old`/`--new` flag pairs is deliberate: agents botch shell-quoting
of multi-line strings and mis-pair repeated flags, and JSON keeps exact
CLI/MCP parity on the edit contract. When neither `--edits` nor a piped stdin is
given at an interactive TTY (no EOF to read), the command fails loud asking for
one rather than hanging on a read that never ends.

Matching is **literal and fail-loud** — never a fuzzy or whole-file fallback.
`old_string` must be non-empty and (unless `replace_all` is true) match exactly
once; a not-found, not-unique, or empty-`old_string` edit aborts the whole
command before any network call with exit code `4` (validation) and an
`invalid_edit` error code naming the offending edit index. `new_string` may be
empty to delete the matched text. The server's stored sha256 is the source of
truth; the client is untrusted, so a generator or apply mismatch fails the
finalize rather than silently shipping wrong bytes.

## Download

`download <artifact-id> [--revision-id <id>] [--output <path>] [--json]` saves
one Revision's Bundle as a zip. It reads the latest Revision unless
`--revision-id` is set. The default path is `./<art_id>.zip`; the canonical
`art_` ID is used because the short artifact ID is the URL's bearer secret.

- The command refuses to overwrite an existing file and checks before any
  download.
- A `pending` Bundle is polled on the same Revision at its `retry_after_seconds`
  for up to 60 seconds. If it is still pending, the command exits `6` with code
  `bundle_pending` and `retry_after_seconds`.
- A `failed` or `disabled` Bundle exits `1` without downloading.
- A missing output directory fails before the wait and download.
- The zip is created exclusively, so a file that appears at the path during the
  wait is never replaced. A failed write removes the partial file.

`--json` returns `{ schema_version, artifact_id, revision_id, title, path,
size_bytes }`.

## Guarded publish and sync

Claimed Workspaces accept files up to 250 MiB, up to 10,000 files and 2 GiB per
Revision, subject to the Workspace storage budget. Directories around 1 GiB are
supported. Free storage defaults to 5 GiB and Pro to 50 GiB. History, bundles,
file entries and pending transfer reservations count toward usage. Deleting an
Artifact frees physical storage after the GC age floor and sweep, potentially
24 hours plus one sweep. Ephemeral publishing retains its 10 MiB file, 25 MiB
tree and 100-file limits. Legacy clients retain single uploads of 10 MiB on
Free and 25 MiB on Pro.

| Invocation                                                 | Scope and deletion behavior                                                                                            |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `publish <path>`                                           | Create one Artifact from the complete selection.                                                                       |
| `publish <path> --artifact-id <ref>`                       | Mirror the whole tree. Remote-only paths are removed under a whole-tree snapshot guard.                                |
| `publish <file> --artifact-id <ref> --to <path>`           | Upsert one remote file. Omitted paths are preserved.                                                                   |
| `publish <dir> --artifact-id <ref> --to <prefix>`          | Upsert the directory below that prefix. Omitted paths are preserved.                                                   |
| `publish <dir> --artifact-id <ref> --to <prefix> --mirror` | Mirror only that prefix. Remote-only descendants are removed under a prefix snapshot guard.                            |
| `publish [<path>] --artifact-id <ref> --delete <path>`     | Delete an explicit file or directory prefix. Repeat `--delete` for more selections. A local path also requires `--to`. |

`--exclude <glob>` is repeatable and applies Node 24 `path.matchesGlob` to local
relative paths after the fixed exclusions. In mirror mode an excluded local
path is absent from the mirror and can therefore be deleted remotely. Use
`--dry-run` to inspect the exact scope first. It emits `{ mode,
head_revision_id, added, changed, removed, unchanged, bytes_to_send_max, limits,
usage }` and creates no upload session. An unchanged publish returns
`no_change: true` and creates no Revision.

Head listing replaces the local manifest cache. Each listing page is pinned to
one Revision. Selected upserts and deletions carry full-file SHA-256 and size
expectations, with absent expectations for additions. Directory deletions carry
a prefix snapshot. Disjoint path commits can both succeed, while overlapping
changes produce `commit_conflict` with structured `details`. Conflicts are not
retried automatically. A selected-path operation that cannot inherit legacy
revision-scoped rows fails and asks for an explicit full-tree mirror. The CLI
never broadens a selected upload into a full replacement.

The CLI hashes files through pinned file handles in 4 MiB blocks. Files above
10 MiB use fixed 4 MiB chunks through the existing encrypted workspace-blob
protocol. `sha256` always describes the full plaintext file. Upload reads verify
recorded digests again and fail with `local_file_changed` if bytes changed.
No 250 MiB file body is buffered in the client. Six transfers run concurrently;
ordered file batches have at most 1,000 entries. Chunk completion verifies the
whole-file digest before finalize and publish.

Transfer plans and operation keys are saved with mode `0600` below the CLI
config directory's `transfers/` folder. State contains file metadata and guards,
never API keys, file bodies or signed URLs. Rerun the same command with the same
local bytes to resume. Target listing skips uploaded chunks and renews signed
URLs. Network and server failures use up to five attempts with backoff;
rate limits honor `Retry-After`. Other 4xx failures, including quota failures
without `Retry-After`, are not retried. The state lookup uses the invocation's
server, Workspace, actor, source path, target and explicit selection flags.
Source hashes and resolved remote metadata do not change that identity. Resume
validates the entire original local selection and retains its saved title,
entrypoint and guards across a head change. Changed local bytes fail with
`local_file_changed`; conflicts leave the saved plan intact. After inspecting
the current head, rerun with `--restart` to intentionally discard that plan and
start against fresh guards. Expired sessions also require `--restart`.
`--restart` cannot be combined with `--dry-run`.

## Retention and management

`publish --pin` pins with the commit. `pin <ref>` and `unpin <ref>` require
publish authority in the owning claimed Workspace and return `ArtifactRetention`.
A pinned Artifact has no scheduled expiry, subject to deletion and platform
policy. Unpin starts a fresh default retention window. Ephemeral Artifacts
cannot be pinned. Pin limits still apply.

`list [--cursor <cursor>]` returns paginated Artifacts including retention.
`usage` returns used, reserved and budget bytes plus pin counts.
`delete <ref> --yes` uses the existing deletion route. Without `--yes`, it
fails with exit `4` before sending the delete request.

## File-wise pull

`pull <ref> [<remote-path>...] --output <directory> [--revision-id <id>]
[--overwrite] [--dry-run]` downloads files or prefixes. No remote paths selects
the whole tree. Local files outside the selection are preserved. Existing files
with matching full-file hashes are skipped. Different existing files stop the
entire plan before writes unless `--overwrite` is given. Dry runs report the
selected files, skips and conflicts without downloading content.

A pull uses one bounded Revision read grant and paginated listings for that
exact Revision, followed by content requests. Concurrent publication never
mixes revisions. Expired grants are renewed for the original Revision. Writes
use root-bounded `openWritable` handles and reject traversal, symlinks and
hardlinks. Bodies stream into an exclusively owned private directory below
the CLI configuration directory's `pulls/` folder. Ownership metadata includes
the destination and partial file identity. Transfer state never uses remote
filenames in the output tree; names ending in `.agent-paste-partial` or
`.agent-paste-partial.json` are ordinary user files. Output directories cannot
contain the CLI configuration directory.

Reruns resume using `Range` and strong `If-Range`; a 200 response restarts the
owned partial. Size and SHA-256 must match before installation. Without
`--overwrite`, fs-safe creates the destination exclusively and copies through
the pinned handle, so a file created concurrently is preserved. With
`--overwrite`, installation uses fs-safe's atomic replacement. Interrupted
local installation can leave a differing destination, which requires explicit
`--overwrite` on rerun. Corrupt owned partials are removed. Legacy files without a known full-file digest fail
verification explicitly. Six files transfer concurrently.

Without `--output`, the existing single-file text/JSON `pull` behavior remains.
`download` still saves a ZIP when available. A Revision with chunked files or
large bundle input can disable ZIP generation with `revision_too_large`; use
`pull --output` instead.

Errors in JSON mode go to stderr as `{ "error": { "code", "message",
"details?", "docs?", "retry_after_seconds?" } }`. There is no result
`schema_version` in error envelopes.

## Directory publish (folder walk, exclusions, symlinks)

`publish <path>` accepts a file or a directory. A directory publish walks the
tree, preserves each file's path relative to the published root (so an HTML
entrypoint can load sibling assets), and infers the entrypoint as the first of
`index.html`, `index.md`, `README.md`, then the sole file when the folder holds
exactly one; a multi-file folder with none of those fails and asks for
`--entrypoint <path>`.

Before `publish --ephemeral` provisions a Workspace, the CLI validates flags,
title, entrypoint, file paths, file counts, byte caps, and
local file readability. `--artifact-id` is invalid with `--ephemeral`; ephemeral
publishes always create a new Artifact. Artifact titles reject terminal control
characters before any publish request.

The walk silently skips a fixed, non-configurable set — `.git/`,
`node_modules/`, `.DS_Store`, `.env`, and `.env.*`. (A skipped symlink, below,
does warn on stderr; the fixed exclusion set does not.)

Symlinks inside a published folder are followed **only** when the link's
resolved real target stays inside the published root **and** does not pass
through an excluded segment. A link whose target resolves outside the folder, or
an innocuously named link that aliases an excluded file (for example
`config.json` → `../.env` or `data.json` → `.env`), is skipped with a stderr
warning rather than uploaded. This keeps a folder publish from silently
uploading bytes the caller did not select and keeps the exclusion list from
being bypassed by symlink aliasing (AP-408). Broken links contribute no bytes
and are skipped; symlinked directories are cycle-guarded by real path so a link
loop cannot recurse forever. Single-file publish (`publish <file>`) follows the
named path directly, since the caller selected it explicitly. Before upload,
the CLI reopens every selected path through `@openclaw/fs-safe`'s root-bounded
reader, which pins the file descriptor and validates the resolved target against
the selected root. Hashing and upload use bounded reads. Every uploaded range
must still match the recorded digest; a changed file fails before publish.

## Exit codes

Stable so scripts can branch without parsing messages. The CLI buckets by the
error's HTTP status, not its `code` — every contract `ErrorCode` maps to a status
(`packages/contracts/src/mcp/error-codes.ts`) and the api-client preserves it, so
status is the durable signal. Keep this table in sync with `exitCodeFor` in
`apps/cli/src/render.ts`.

| Code | Name                | Cause                                                                                                   |
| ---- | ------------------- | ------------------------------------------------------------------------------------------------------- |
| 0    | success             | command completed                                                                                       |
| 1    | generic / transport | any non-`AgentPasteError` failure, including fetch transport errors, or a 4xx outside the buckets below |
| 2    | auth                | HTTP 401/403 (e.g. `not_authenticated`)                                                                 |
| 3    | quota               | HTTP 429 — rate limits and write-allowance (`write_allowance_exceeded`, `rate_limited_*`)               |
| 4    | validation          | HTTP 400/422                                                                                            |
| 5    | not found           | HTTP 404                                                                                                |
| 6    | server              | HTTP 5xx                                                                                                |

`whoami` is the exception scripts most often trip over: a signed-out result is a
valid auth-state answer, so `whoami --json` exits `0` and emits
`{ "authenticated": false }` when no credential is resolvable. Scripts and agents
must branch on the JSON field. Commands that require auth, such as `publish`
without `--ephemeral`, still fail with the auth exit bucket when no usable
credential exists.

## Progress

`publish` reports per-file upload progress in `rich` mode only, repainting one
in-place line as each file completes (`done/total files · bytes sent`). Uploads
run with at most six files in flight, and the progress callback advances once
for each completion. In `plain`/`json` mode no progress is emitted.

## Dependencies

The published CLI bundles its JavaScript, including `@openclaw/fs-safe` for
descriptor-pinned, root-bounded local file reads. Its optional dependencies are
the exact platform-native packages declared by the pinned `fs-safe` build
dependency. npm selects the matching platform package; the full `fs-safe`
package and its archive dependencies are not installed for CLI users. The
prepublish guard checks that the native package set matches the bundled version.

Runtime validation remains enabled. CLI consumers import domain contracts
without OpenAPI generation or server registries. The executable is minified
with line wrapping, and the npm files allowlist includes only `dist/index.js`,
README, license, and npm's package metadata. Type declarations and source maps
are not shipped.

Both npm and standalone builds use the workspace `source` export condition.
Third-party packages resolve through their normal JavaScript exports, so their
TypeScript declarations do not select a different runtime module format.

The npm CLI bundle build enforces a 512 KiB executable limit, 8,192 lines, and 16 KiB per
line. These leave headroom below the pinned Hermes lifecycle scanner's shared
1 MiB, 16,384-line, and 64 KiB-per-line limits. They measure the uncompressed
executable, not the npm tarball or native binaries. See the
[upstream scanner](https://github.com/NousResearch/hermes-agent/blob/a7254e2d4c170725a4136591e96efc5066251d2c/cron/lifecycle_guard.py#L313).

Rich output is hand-rolled ANSI in `apps/cli/src/render.ts` rather than a
`chalk`/`ora`-style library.

## Credential storage

Linux stores login credentials through `secret-tool` with the secret on stdin.
macOS can read credentials previously stored in Keychain, but the `security`
command has no secure non-interactive write form. New macOS credentials use the
CLI's `0600` file store and emit a stderr warning. The CLI never puts a credential
secret in process arguments.

## Agent publish help

`agent-paste help publish` is the CLI's agent-oriented prompt for publish mode
selection. `agent-paste publish --help` prints the same guide. The guide must
lead with mode choice and exact commands before longer flag descriptions:

| Mode            | Current shipped meaning                                                        | Command sequence                                                                                                          | Agent returns                                      |
| --------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Signed in       | Durable per-Artifact capability website.                                       | `agent-paste publish <path> --json`                                                                                       | `url`                                              |
| Accountless 24h | Same capability website with short-lived ownership and an optional claim path. | `agent-paste publish <path> --ephemeral --json` or `agent-paste publish <path> --ephemeral --claim-code <clm_...> --json` | `url`; `claim_url` when the human wants to keep it |

The guide should tell agents to run `whoami --json` first using the inherited
environment. Explain API key precedence and that a configured key needs no
login. Only a signed-out result should lead to API key setup or `agent-paste
login` with a browser on the same machine or `login --device-code` in a sandbox.
Keep device login running for human approval, then check `whoami` again. Use `--artifact-id`
when revising an existing Artifact. If copied
instructions include `--claim-code <clm_...>`, the guide
must tell agents to preserve it on `publish --ephemeral`; it is for attribution
and claim links.

## Publish human output

Authenticated `publish` in `rich`/`plain` mode leads with the live **View**
capability `url`, then **Expires**,
the upload summary, and an **Update** line:

- **Update** — the channel-correct command to revise this Artifact in place
  (`publish <path> --artifact-id <url>`). Agents can carry this URL across
  handoffs and revise the same Artifact without saving a separate ID.

## Ephemeral publish human output

`publish --ephemeral` uses the same JSON fields as authenticated publish plus
the claim fields `claim_token`, `claim_url`, `workspace_id`, `api_key_id`, and
`claim_token_id`.

`--claim-code <clm_...>` is optional attribution for the claim flow. It is valid
only on `publish --ephemeral`. When present, the CLI sends it through ephemeral
provision and publish; the API embeds it in the Claim Token returned by
provision. The CLI never returns it as `claim_code`, never changes
`url`, and never puts it in URL query strings. Invalid claim-code inputs
are ignored rather than blocking ephemeral publish.

In `rich`/`plain` mode, the working no-login link is the primary handoff and the
claim link is the upgrade path:

- **Link** — the capability `url`. It works immediately for any recipient and is
  the `→ open` target.
- **Claim** — the link to log in, keep, and own the Artifact
  (`claim_url`).

Agents relaying ephemeral publish results to humans pass `url`. `claim_url` is
only the keep and upgrade path.
