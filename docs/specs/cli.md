# CLI output contract

The `agent-paste` CLI serves both humans at a terminal and machines (agents, CI,
scripts). This spec is the source of truth for how it renders output and signals
failure. Command behavior itself is in [`features.md`](./features.md); this
document owns the cross-command output contract.

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

## JSON contract

- Every JSON payload carries a top-level `schema_version` string. The current
  version is `"1"`. Consumers should branch on it; new fields may be added
  within a version, but field removals or renames bump it.
- Object payloads are emitted as `{ "schema_version": "1", ...fields }`.
- `publish --json` is content-only and private. It emits
  `{ schema_version, artifact_id, revision_id, title, private_url,
revision_content_url, agent_view_url, expires_at, bundle, upload_stats }`.
  `private_url` is the login-walled clean viewer at `/v/<artifactId>` for a
  Workspace Member, the same field the MCP server returns. It is the only link
  publish creates. `revision_content_url` is a signed URL for one exact Revision
  file, not a live share link. `agent_view_url` returns file metadata and signed
  per-file URLs. `upload_stats` is `{ total_files, total_bytes, uploaded_files,
uploaded_bytes, reused_files, reused_bytes }`.
- There is no `--share` input and no `shared` output bit. No-login unlisted
  sharing is the separate `set-visibility <artifact-id> unlisted` command, which
  mints or reuses the one Share Link and prints `unlisted_url`.
- `publish --ephemeral --json` emits the normal publish fields except
  `private_url`, plus `{ unlisted_url, claim_token, claim_url, workspace_id,
api_key_id, claim_token_id }`. When the caller supplies
  `--claim-code <clm_...>`, the API embeds it in the claim token; the CLI never
  returns `claim_code` as a separate field.
- `set-visibility <artifact-id> unlisted --json` emits
  `{ schema_version, artifact_id, visibility, access_link_id, unlisted_url }`.
  `unlisted_url` is the no-login Access Link Signed URL for the Artifact's Share
  Link and follows later publishes. Browser rendering depends on the URL
  fragment; a plain HTTP fetch cannot verify the final rendered page.
- `set-visibility <artifact-id> private --json` revokes active Access Links and
  emits `{ schema_version, artifact_id, visibility, private_url,
revoked_access_link_ids }`.
- `pull <artifact-id> <path> [--revision-id <id>]` reads one stored file back
  ([ADR 0090](../adr/0090-agent-file-read-back-api-decrypts-member-plaintext.md)).
  Default output is cat-like (the raw text body to stdout, so `pull … > file`
  works); `--json` emits `{ schema_version, path, sha256, size_bytes, is_binary,
body? }`. A binary file has no inline body: `--json` reports `is_binary: true`
  with no `body`, and plain mode errors (raw bytes would corrupt the stream). An
  oversize text file likewise has no `body`; fetch it via the content URL.
- `edit <artifact-id> <path>` applies literal find/replace edits to one stored
  file and publishes the result as a new Revision of the same Artifact (the
  parity twin of the MCP `multi_edit` tool; see [the edit verb](#edit-literal-findreplace-revise)).
  It emits the same JSON as a successful `publish` (the new Revision's
  `private_url`, `artifact_id`, `upload_stats`, …). When the edits reproduce the
  stored bytes byte-for-byte it is a no-op: `--json` emits `{ schema_version,
artifact_id, noop: true, title, private_url }` and nothing is published.

## Edit (literal find/replace revise)

`edit <artifact-id> <path> [--edits <file>] [--json]` is a one-file, in-place
revise that mirrors the MCP `multi_edit` tool ([ADR 0091](../adr/0091-client-side-revise-engine-and-literal-edit-tools.md)).
Both surfaces share one engine (`reviseOnePath` in `@agent-paste/revise-core`):
the CLI reads the stored file, applies the edits client-side, and publishes the
result as a new Revision under the unchanged Artifact id — so the stable link
live-updates instead of stranding the open page on a new Artifact.

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

## Incremental revise (manifest cache + diffs)

On a revise (`publish <path> --artifact-id <id>`), the CLI sends only what
changed instead of the whole tree ([ADR 0090](../adr/0090-agent-file-read-back-api-decrypts-member-plaintext.md)).
It caches the last published manifest per artifact (`paths + sha256 + revision_id`)
under the CLI config dir and, on the next revise, diffs the working dir against
that cache: unchanged files inherit by reference (not re-hashed, not re-uploaded),
removed files become `deleted_paths`, and changed text files are sent as a
verified unified diff against `base_revision_id` (whole blob for binary or when the
diff is not smaller). The diff generator (`diffWithSelfCheck`) lives in the shared
`@agent-paste/revise-core` package ([ADR 0091](../adr/0091-client-side-revise-engine-and-literal-edit-tools.md)),
the single copy both the CLI and MCP use; it self-checks (applies its own diff and
verifies the result digest) before attaching a patch, so a generator bug degrades
to a correct whole-blob upload, never a finalize conflict. There is no diff size
threshold. If the cached base is no longer usable on the server (a concurrent
revise elsewhere, a retained/deleted base, or a non-inheritable base file), the
CLI drops the cache and re-publishes the whole working directory once; a corrupt
or schema-drifted cache is treated as a cache miss. The cache holds no bytes and
no secrets and is written `0600`.

- Errors in `json` mode are emitted on **stderr** as
  `{ "error": { "code", "message", "docs?" } }` (no `schema_version` — it is an
  error envelope, not a result).

## Removed command names

`make-public` was removed without an alias or deprecation window. Update agents,
scripts, and pinned command lists to use `set-visibility <artifact-id> unlisted`
for no-login Share Links and `set-visibility <artifact-id> private` to revoke
active Access Links. Unlisted JSON output uses `unlisted_url` (not `public_url`).
There is no legacy alias.

## Exit codes

Stable so scripts can branch without parsing messages. The CLI buckets by the
error's HTTP status, not its `code` — every contract `ErrorCode` maps to a status
(`packages/contracts/src/mcp/error-codes.ts`) and the api-client preserves it, so
status is the durable signal. Keep this table in sync with `exitCodeFor` in
`apps/cli/src/render.ts`.

| Code | Name             | Cause                                                                                     |
| ---- | ---------------- | ----------------------------------------------------------------------------------------- |
| 0    | success          | command completed                                                                         |
| 1    | generic          | any non-`AgentPasteError` failure, or a 4xx outside the buckets below                     |
| 2    | auth             | HTTP 401/403 (e.g. `not_authenticated`)                                                   |
| 3    | quota            | HTTP 429 — rate limits and write-allowance (`write_allowance_exceeded`, `rate_limited_*`) |
| 4    | validation       | HTTP 400/422                                                                              |
| 5    | not found        | HTTP 404                                                                                  |
| 6    | network / server | HTTP 5xx                                                                                  |

`whoami` is the exception scripts most often trip over: a signed-out result is a
valid auth-state answer, so `whoami --json` exits `0` and emits
`{ "authenticated": false }` when no credential is resolvable. Scripts and agents
must branch on the JSON field. Commands that require auth, such as `publish`
without `--ephemeral`, still fail with the auth exit bucket when no usable
credential exists.

## Progress

`publish` reports per-file upload progress in `rich` mode only, repainting one
in-place line as each file completes (`done/total files · bytes sent`). The
contract is granularity-agnostic: the upload loop is serial today, so it ticks
`1/N, 2/N…`; a future parallel upload calls the same update on each completion
and behaves identically. In `plain`/`json` mode no progress is emitted.

## Dependencies

The published CLI has **zero runtime dependencies** — it is bundled with esbuild
and all tooling lives in `devDependencies`. Rich output is therefore hand-rolled
ANSI in `apps/cli/src/render.ts` rather than a `chalk`/`ora`-style library, to
keep the install small and the supply chain clean.

## Agent publish help

`agent-paste help publish` is the CLI's agent-oriented prompt for publish mode
selection. `agent-paste publish --help` prints the same guide. The guide must
lead with mode choice and exact commands before longer flag descriptions:

| Mode      | Current shipped meaning                                                                                     | Command sequence                                                                                                          | Agent returns                                                               |
| --------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Private   | Default authenticated publish. Login-walled `private_url`; no unauthenticated access.                       | `agent-paste publish <path> --json`                                                                                       | `private_url` only when the recipient can log in                            |
| Unlisted  | No-login Share Link that follows later publishes and can be revoked.                                        | `agent-paste publish <path> --json` then `agent-paste set-visibility <artifact_id> unlisted --json`                       | `unlisted_url`                                                              |
| Ephemeral | Accountless publish for no-login environments. Short-lived, claimable, and script-disabled while unclaimed. | `agent-paste publish <path> --ephemeral --json` or `agent-paste publish <path> --ephemeral --claim-code <clm_...> --json` | `unlisted_url` (working no-login link) and `claim_url`; never `private_url` |

The guide should tell agents to run `whoami --json` before choosing
`--ephemeral`, to use `--artifact-id` when revising an existing Artifact, and to
avoid handing `revision_content_url` back as the final live page. If copied
instructions include `--claim-code <clm_...>`, the guide must tell agents to
preserve it on `publish --ephemeral`: it is public claim-funnel attribution, not
authorization, ownership, billing, idempotency, a Claim Token, or a secret.

## Publish human output

Authenticated `publish` in `rich`/`plain` mode leads with the live **View** URL
(`private_url` — the login-walled `/v/<artifactId>` clean viewer for a Workspace
Member; publish is private, so this is the only link it returns), then **Expires**,
the upload summary, and an **Update** line:

- **Update** — the channel-correct command to revise this Artifact in place
  (`publish <path> --artifact-id <artifact_id>`). This is the human surface's only
  explicit revise handle, and it is deliberate: it teaches the agent the revise verb
  at the moment it holds the id, so an edit adds a Revision (stable link,
  live-updates the open page) instead of republishing a new Artifact on a new link.
  (The default private `View`/`→ open` URL is the `/v/<artifact_id>` clean viewer,
  so the id appears there too; the `Update` line is what spells out the revise
  command.) The `revision_id` and snapshot content URLs stay on the JSON surface.

## Ephemeral publish human output

`publish --ephemeral` uses the same JSON fields as authenticated publish plus the
server-minted `unlisted_url` and the claim fields `claim_token`, `claim_url`,
`workspace_id`, `api_key_id`, and `claim_token_id`. It omits `private_url`.

`--claim-code <clm_...>` is optional attribution for the claim flow. It is valid
only on `publish --ephemeral`. When present, the CLI sends it through ephemeral
provision and publish; the API embeds it in the Claim Token returned by
provision. The CLI never returns it as `claim_code`, never changes
`unlisted_url`, and never puts it in URL query strings. Invalid claim-code inputs
are ignored rather than blocking ephemeral publish.

In `rich`/`plain` mode, the working no-login link is the primary handoff and the
claim link is the upgrade path:

- **Link** — the `unlisted_url`, a no-login, script-disabled Share Link the server
  auto-creates for an ephemeral publish. It works immediately for any recipient and
  is the `→ open` target.
- **Claim** — the link to log in, keep, make interactive, and own the Artifact
  (`claim_url`).

The `private_url` (login-walled member viewer) is intentionally omitted from the
ephemeral human handoff: the Artifact lives in an unclaimed **Ephemeral Workspace**,
so that route 404s for cold recipients until a claim. Agents relaying ephemeral
publish results to humans should pass `unlisted_url` (or `claim_url` for the
keep/upgrade step), never `private_url`.
