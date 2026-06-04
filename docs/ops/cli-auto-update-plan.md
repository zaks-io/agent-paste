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

## Phase 2 — Background update check + per-channel nag — DONE

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

## Phase 4 — Release-pipeline wiring (close the loop) — DONE (npm + KV)

- GitHub-driven KV write + npm publish (ADR 0080 §6): a separate
  `release: published` workflow (`.github/workflows/cli-advertise.yml`, gated on
  the `cli-v*` tag) publishes `@zaks-io/agent-paste` to npm (`--provenance`) and
  then writes the `CLI_RELEASE` value in each env with
  `wrangler kv key put cli-release --binding CLI_RELEASE --env <env>` (id resolved
  from `wrangler.jsonc`, no hardcoded ids). npm auth is OIDC trusted publishing
  (no stored token); the KV write reuses the deploy `CLOUDFLARE_API_TOKEN`/
  `CLOUDFLARE_ACCOUNT_ID` secrets, scoped to that step. No `api` redeploy.
- Single version source: `apps/cli/package.json` drives the baked binary version,
  the npm version, and the KV `latest`. The build job and the advertise job both
  assert the dispatch/release tag equals `cli-v<version>`, so the channels can't
  diverge. `min_supported` is set equal to `latest` for now (no force-upgrade
  floor yet; revisit when a real minimum is needed).
- Remaining follow-up: update `apps/cli/README.md` with `--version`, `upgrade`,
  `AGENT_PASTE_NO_UPDATE_CHECK`, and the update-check behavior (folds in with
  Phase 3's `upgrade` command).

**Manual prerequisite (one-time, before the first automated release):** a `0.0.0`
placeholder is already published to npm, so the trusted-publishing precondition
(package must exist) is met. On npmjs.com → package → Settings → Trusted
Publishers, add a GitHub Actions publisher: org `zaks-io`, repo `agent-paste`,
workflow file `cli-advertise.yml` (leave Environment blank unless the job adds a
matching `environment:`). After this, CI publishes via OIDC with no stored npm
token.

(`CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` already exist as repo secrets
from the deploy workflow — no new Cloudflare setup.)

**Done:** publishing a `cli-v*` GitHub Release publishes the package to npm and
advertises the new version in `CLI_RELEASE` KV with no manual step and no `api`
redeploy; the tag, npm version, and advertised `latest` all derive from
`package.json`.

## Out of scope / explicitly rejected

- Silent binary self-update (ADR 0080 §4).
- Auto-promoting the draft release: a human still publishes the GitHub Release;
  npm publish + KV advertise then fire on `release: published`. (npm publish
  itself is now in scope — it runs automatically once the human publishes.)
- Reading `package.json` at runtime for the version (ADR 0080 §1).

## Open questions for review

- Throttle window: 24h is the proposed default; confirm.
- KV key shape: one JSON value (`{ latest, min_supported }`) under a single key
  vs. two keys. One JSON value is simpler to read and write atomically.
