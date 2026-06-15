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
- `publish` is content-only and private: it emits one handoff link, `private_url`
  (the login-walled clean viewer at `/v/<artifactId>` for a Workspace Member) —
  the same field the MCP server returns. There is no `--share` input and no
  `shared` output bit. Making an Artifact public is the separate `make-public`
  command, which mints or reuses the one Share Link and prints its no-login
  Access Link Signed URL.
- `pull <artifact-id> <path> [--revision-id <id>]` reads one stored file back
  ([ADR 0090](../adr/0090-agent-file-read-back-api-decrypts-member-plaintext.md)).
  Default output is cat-like (the raw text body to stdout, so `pull … > file`
  works); `--json` emits `{ schema_version, path, sha256, size_bytes, is_binary,
body? }`. A binary file has no inline body: `--json` reports `is_binary: true`
  with no `body`, and plain mode errors (raw bytes would corrupt the stream). An
  oversize text file likewise has no `body`; fetch it via the content URL.

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

`publish --ephemeral` uses the same JSON fields as authenticated publish plus
`claim_token`, `claim_url`, `workspace_id`, `api_key_id`, and `claim_token_id`.
The JSON contract is unchanged; only human-readable layout differs.

In `rich`/`plain` mode, the claim link is the primary handoff:

- **Claim** — the link to open, keep, and unlock the Artifact (`claim_url`).
  The `→ open` hint targets this URL.
- **View** — the `private_url` (the `/v/<artifactId>` clean viewer for an ephemeral
  publish), labeled as working only after claim. Until a human redeems the
  **Claim Token**, this route 404s for cold recipients because the Artifact lives
  in an unclaimed **Ephemeral Workspace**.

Agents relaying ephemeral publish results to humans should pass `claim_url`, not
`private_url`.
