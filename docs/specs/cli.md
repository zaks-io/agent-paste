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
  point of `--json`); `--quiet` without `--json` prints nothing on success.

## JSON contract

- Every JSON payload carries a top-level `schema_version` string. The current
  version is `"1"`. Consumers should branch on it; new fields may be added
  within a version, but field removals or renames bump it.
- Object payloads are emitted as `{ "schema_version": "1", ...fields }`.
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
