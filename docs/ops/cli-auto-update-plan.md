# CLI auto-update — implementation plan

Implements [ADR 0080](../adr/0080-cli-version-baking-update-check-and-binary-self-upgrade.md).
Goal: the CLI knows its own version, learns the latest from the Agent Paste API,
and gives each distribution channel (binary / npm-global / npx) a safe response
to staleness. Binary self-update is explicit (`agent-paste upgrade`), never
silent.

Phases are ordered so each is independently shippable and the earlier ones
unblock the later ones. Phases 1–2 deliver the user-visible nag; phase 3 adds
binary self-upgrade; phase 4 is the release-pipeline wiring.

## Phase 1 — Bake the version in (prerequisite, no behavior change yet) — DONE

- `apps/cli/build.mjs`: read `version` from `package.json`, pass
  `define: { __AGENT_PASTE_CLI_VERSION__: JSON.stringify(version) }` to esbuild.
- `.github/workflows/cli-release.yml` compile step: add
  `--define:__AGENT_PASTE_CLI_VERSION__="\"$VERSION\""` (derive `$VERSION` from
  the input tag or `package.json`).
- `apps/cli/src/version.ts` (new, tiny): `export const CLI_VERSION = ... ` falling
  back to a `declare const __AGENT_PASTE_CLI_VERSION__` with a `"0.0.0-dev"`
  default for un-defined dev runs (e.g. `vitest`, `pnpm dev`).
- `apps/cli/src/index.ts`: add `version` command and `--version` / `-v` flag that
  print `CLI_VERSION`. Route them in `main()` before auth resolution (like
  `help`).
- Tests: `version` prints the constant; `--version` short-circuits before any
  client resolution.

**Done:** `agent-paste --version` and `agent-paste version` print the package
version; a compiled binary prints the same string; dev/test runs print
`0.0.0-dev` without throwing.

## Phase 2 — Background update check + per-channel nag

- API: add `cli.version` Route Contract in `packages/contracts`
  (`GET /v1/public/cli-version`, unauthenticated, response
  `{ latest, min_supported }`), mounted through the registrar next to
  `agentView.public`. Add the OpenAPI entry.
- API KV: add a `CLI_RELEASE` KV namespace binding to `apps/api/wrangler.jsonc`
  (per-env IDs, same shape as the existing `DENYLIST` binding) and to
  `apps/api/src/env.ts`. The handler reads `latest`/`min_supported` from KV with
  a safe default if the key is unset. Seed the value by hand for now
  (`wrangler kv key put`); phase 4 automates the write. Choosing KV (not a
  deployed constant) is what lets a new release be advertised without redeploying
  `api`.
- Caching (ADR 0080 §2): set `Cache-Control: public, max-age=300` on the response
  so CF edge-caches it and most requests never run the Worker; on edge misses,
  memoize the KV value in a module-scope variable with a short TTL so KV is hit at
  most once per TTL per isolate. Not the two-layer `caches.default` machinery —
  that's for authenticated hot-path lookups, not a public config read.
- `apps/cli/src/update-check.ts` (new):
  - `detectChannel()` → `"npx" | "npm-global" | "binary" | "unknown"` from
    `npm_config_user_agent` / `npm_execpath` and the running file path.
  - `shouldCheck()` → false when `AGENT_PASTE_NO_UPDATE_CHECK`, `CI`,
    `!stdout.isTTY`, `--json`, or `--quiet`; or when the cached check is < 24h
    old. Cache + timestamp in `~/.config/agent-paste/update-check.json`.
  - `runUpdateCheck()` → fetch the endpoint (short timeout, fail open / swallow
    all errors), compare to `CLI_VERSION` via semver, write cache, and on a
    newer `latest` print one stderr line tailored by channel:
    - npx → print nothing,
    - npm-global → `npm i -g @zaks-io/agent-paste@latest`,
    - binary/unknown → `run \`agent-paste upgrade\``.
  - If `CLI_VERSION < min_supported`, print a louder stderr warning regardless of
    channel (still does not hard-fail locally).
- `apps/cli/src/index.ts`: call the check in a `finally`/after-success hook in
  `main()` so it runs after the command's own output and never affects exit code.
- Tests: each channel produces the right line (or none); suppression flags each
  silence it; a fetch error is swallowed; throttle skips a fresh cache; `--json`
  output on stdout is byte-for-byte unchanged with the check enabled.

**Done:** running any command on a stale CLI prints exactly one channel-correct
hint to stderr at most once per 24h; CI/`--json`/non-TTY/agents see nothing;
network failure is invisible; stdout is never touched.

## Phase 3 — `agent-paste upgrade` (binary self-update)

- `apps/cli/src/upgrade.ts` (new): port the download+verify flow from
  `apps/apex/src/install-sh.ts`:
  - OS/arch → asset name (reuse the installer's mapping; factor the table so the
    two cannot drift, or mirror with a test asserting parity).
  - Resolve version (latest from phase 2, or `--version <tag>` to pin).
  - Download asset + `SHA256SUMS` from the GitHub Release, `https`-only, fail on
    any HTTP error.
  - Verify bytes against `SHA256SUMS`; refuse on mismatch or missing sha256
    capability.
  - Atomic replace: temp file in the **same dir** as the running binary →
    `chmod +x` → `rename` over self. Windows: rename running exe aside, then
    move new into place.
  - Refuse / redirect to npm guidance when `detectChannel() !== "binary"`.
- `apps/cli/src/index.ts`: route `upgrade` (with `--version`).
- Tests (no real network): verification rejects a tampered byte; mismatch and
  missing-checksum paths error and do not write; an npm/npx invocation prints the
  npm guidance instead of touching the filesystem; the atomic-replace helper
  writes the temp in the binary's own directory.

**Done:** on a binary install, `agent-paste upgrade` downloads, verifies against
`SHA256SUMS`, and atomically replaces the binary; a corrupted download is
refused; invoked from npm/npx it prints the npm command instead.

## Phase 4 — Release-pipeline wiring (close the loop)

- GitHub-driven KV write (ADR 0080 §6). Preferred: a `release: published`
  -triggered Action step (or a step appended to the release flow) that runs
  `wrangler kv key put` for the `CLI_RELEASE` value in each env, using the same
  CI credentials that already deploy Workers. No `api` redeploy — it is a single
  KV write. (Fallback, only if automation must live off GitHub Actions: an
  operator-authenticated webhook endpoint in the `/admin/...` family that writes
  KV on `release` events, with signature verification.)
- Reconcile npm `version` ↔ `cli-vX.Y.Z` tag: derive the tag from
  `package.json` (or vice versa) in the release flow so they cannot diverge, and
  derive the KV `latest` value from the same source.
- Docs: update `apps/cli/README.md` with `--version`, `upgrade`,
  `AGENT_PASTE_NO_UPDATE_CHECK`, and the update-check behavior.

**Done:** publishing a CLI release writes the `CLI_RELEASE` KV value with no
manual step and no `api` redeploy; the release tag, npm version, and advertised
`latest` all derive from one source; the README documents version/upgrade/opt-out.

## Out of scope / explicitly rejected

- Silent binary self-update (ADR 0080 §4).
- Auto-publishing to npm or auto-promoting the draft release.
- Reading `package.json` at runtime for the version (ADR 0080 §1).

## Open questions for review

- Throttle window: 24h is the proposed default; confirm.
- KV key shape: one JSON value (`{ latest, min_supported }`) under a single key
  vs. two keys. One JSON value is simpler to read and write atomically.
