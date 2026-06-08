# CLI Version Baking, Update Check, and Binary Self-Upgrade

Status: Accepted / implemented.

The `@zaks-io/agent-paste` CLI ships through three distribution channels with
no way to tell a user — human or agent — that a newer version exists, and the
standalone binary channel has no package manager to pull updates through. This
ADR records how the CLI learns its own version, how it learns the latest
version, and what each channel does about staleness.

## What is actually true today

- **Three channels, different update mechanics.** The CLI is published as (1) a
  standalone single-file binary cross-compiled with `bun build --compile` per
  OS/arch, attached to a GitHub Release, installed to `~/.local/bin` by
  `install.sh`/`install.ps1` (served from `apps/apex`); (2) an `npm i -g`
  global install; (3) `npx @zaks-io/agent-paste`. See `apps/cli/README.md`.
- **The running CLI knows its own version.** `apps/cli/build.mjs` (esbuild
  bundle) and the `bun build --compile` step in `.github/workflows/cli-release.yml`
  both inject `apps/cli/package.json`'s `version`; `agent-paste version`,
  `--version`, and `-v` print that baked value.
- **GitHub Release publish is the human gate; npm + KV are automated after it.**
  `cli-release.yml` is `workflow_dispatch` and produces a **draft** release for
  human review. Publishing that draft fires `cli-advertise.yml` on
  `release: published`, which re-verifies the `cli-v<package.json version>` tag,
  publishes npm through trusted publishing, and writes the `CLI_RELEASE` KV value.
  Drafts stay mutable for release testing reruns; published releases are
  immutable and attested by GitHub.
  "Auto-update" here means _the client noticing a newer published release_ and
  binary users explicitly running `agent-paste upgrade`; it never silently
  self-mutates.
- **There is precedent for unauthenticated public API routes.**
  `agentView.public` (`/v1/public/agent-view/{token}`) is served with no auth
  through the contract-driven route registrar (ADR 0072,
  `packages/contracts/src/routes/registry.ts`). A public version endpoint fits
  the same shape.
- **No `/meta` or version endpoint exists** on `api`.

## The problem, precisely

A CLI in the field — frequently embedded in agents and CI — has no signal that
it is running an old, possibly protocol-incompatible build. The binary channel
is the worst case: there is no `npm`/`npx` resolution behind it, so a stale
binary stays stale forever unless the user re-runs the `curl | sh` installer by
hand. We need (a) the CLI to know what it is, (b) a cheap, non-blocking way for
it to learn what the latest is, (c) a per-channel response that never surprises
an agent or corrupts CI output.

## Decision

### 1. Bake the version into every build artifact

Inject `package.json`'s `version` at build time so the bundle and the binary
both carry it:

- `apps/cli/build.mjs`: esbuild `define: { __AGENT_PASTE_CLI_VERSION__: JSON.stringify(version) }`.
- `cli-release.yml` compile step: `bun build --define __AGENT_PASTE_CLI_VERSION__=...`.

Reading `package.json` at runtime is rejected: the single-file binary has no
`package.json` on disk next to it, and `import.meta`/`__dirname` resolution
inside a `bun --compile` blob is unreliable. A compile-time constant is the only
form that survives all three channels identically.

Add a `version` command and `--version`/`-v` flag to `apps/cli/src/index.ts`
that print the baked constant. This is the prerequisite for everything below.

### 2. The version source of truth is the Agent Paste API, not GitHub or npm

A new **unauthenticated** route — `cli.version`,
`GET /v1/public/cli-version` — returns:

```json
{ "latest": "0.2.0", "min_supported": "0.1.0" }
```

declared as a Route Contract in `packages/contracts` and mounted through the
existing registrar (ADR 0072), alongside `agentView.public`. The API owns the
values, read from a **KV value** (its own namespace, e.g. `CLI_RELEASE`, bound
per-env like the existing `DENYLIST` binding) — not from a live npm/GitHub
lookup on the hot path, and not from a deployed constant.

KV is the store specifically so **advertising a new version is a data write, not
a code deploy**: the release process writes `latest`/`min_supported` to KV and
the running `api` Workers pick it up with no redeploy of unrelated code. A
deployed constant was rejected for exactly this reason — it would couple the
"what's the latest CLI" fact to an `api` release cycle that has nothing to do
with it.

Caching, front to back, all cheap because the response is public, unauthenticated,
and low-churn:

1. **CF edge cache (primary).** The handler sets a `Cache-Control` response header
   (e.g. `public, max-age=300`), so Cloudflare serves repeat requests at a colo
   straight from the edge — the Worker never runs and KV is never touched for a
   hit. This is the cheapest possible path and, for a public GET, the right front
   line. A short max-age bounds staleness to minutes; a release can additionally
   purge the cache for an instant cut-over if ever needed (not required given the
   client's own 24h throttle).
2. **Module-scope memory cache (fallback for edge misses).** On the requests that
   do reach the Worker (cold colo, post-expiry), memoize the KV value in a
   module-scope variable with a short TTL per isolate, so KV is hit at most once
   per TTL per isolate rather than once per origin request.

This deliberately does **not** use the two-layer `caches.default` machinery
(ADR 0062), which exists for hot-path _authenticated_ lookups that can't be edge-
cached. A public config read is simpler: a response header does most of the work.
The CLI's own 24h client-side throttle (§3) is the dominant cache regardless;
these server caches just keep a request spike from fanning out to the Worker/KV.

The API is chosen over the GitHub `releases/latest` redirect (which `install.sh`
uses) and over the npm registry because only a server we control can:

- **Force an upgrade.** `min_supported` lets the server tell a client it is too
  old to be trusted (e.g. it speaks a retired protocol). GitHub/npm can only say
  "newer exists," never "you must move."
- **Give one answer to all three channels.** The binary channel does not
  otherwise touch npm; npm/npx do not touch GitHub Releases. A single API answer
  is channel-agnostic.
- **Yield version-spread telemetry** from the request itself (User-Agent),
  informing when an old version can be retired.

The cost is one more public route. It fails open: any error resolving the
endpoint is swallowed and the CLI proceeds (see §4).

### 3. The check is background, throttled, cached, and silenceable

On any command, **after** the real work completes, the CLI runs an update check
that is gated to at most once per 24h by a timestamp in
`~/.config/agent-paste/update-check.json` (same config dir as `credentials.json`
fallback). The result is cached there so the network is hit at most once per
interval, not once per invocation. On a hit, the CLI prints **one line to
stderr** after the command output; it never blocks, never mutates anything, and
never touches stdout (so `--json` consumers and piped output stay clean).

The check is suppressed when **any** of these hold, because the CLI's primary
consumers are agents and CI where a nag line is noise or a log-corruption risk:

- `AGENT_PASTE_NO_UPDATE_CHECK=1` (or `--no-update-check`),
- `process.env.CI` is set,
- stdout is not a TTY,
- the global `--json` or `--quiet` flag is set.

`min_supported` is the one exception to "never block": if the baked version is
below `min_supported`, the CLI prints a louder stderr warning. It still does not
hard-fail the local command — the server enforces protocol incompatibility at
the API boundary; the CLI only advises.

### 4. Each channel gets the response it can safely take

The check detects the channel from the runtime and tailors the hint:

- **npx** — already auto-updating; npx re-resolves the latest matching version
  each run. Detected via `npm_config_user_agent` / `npm_execpath`. The CLI does
  **nothing** and **suppresses the nag** entirely. No work beyond detection.
- **npm global** — a process cannot safely self-mutate its own global npm
  install (permissions, partial-write risk). Detected by the running file path
  living under a `node_modules`/npm prefix. The CLI prints the exact command:
  `npm i -g @zaks-io/agent-paste@latest`. No self-update.
- **standalone binary** — the only channel where self-update is reasonable and
  the only one with no package manager behind it. The CLI gains an **explicit**
  `agent-paste upgrade` command (§5); the background check prints
  "run `agent-paste upgrade`". The binary is **never** silently replaced.

Silent self-mutation of an executable is rejected for the binary channel:
surprise-rewriting a binary mid-run is hostile in CI, expands the supply-chain
blast radius, and is hard to audit. Explicit consent via `upgrade` plus a nag is
the standard for this class of tool (gh, deno, bun, rustup all gate self-update
behind an explicit subcommand or a prompt).

### 5. `agent-paste upgrade` reuses the installer's verified-download flow

`upgrade` ports the proven logic already in `install.sh` (`apps/apex/src/install-sh.ts`):

1. Detect OS/arch → release asset name (the same mapping the installer uses).
2. Resolve the target version (latest from §2, or `--version <tag>` to pin).
3. Download the asset and `SHA256SUMS` from the GitHub Release over
   `https`-only, fail loudly on any HTTP error.
4. **Verify** the downloaded bytes against `SHA256SUMS` — refuse to install on
   mismatch or when no sha256 tool/implementation is available. This invariant
   from `install.sh` is non-negotiable: never install an unverified binary.
5. Atomically replace the running binary: write to a temp file in the **same
   directory** (so `rename` is atomic, not a cross-device copy), `chmod +x`,
   then `rename` over the current executable. On Windows, rename the running
   exe aside first (it cannot be deleted while running), then move the new one
   into place.

`upgrade` only operates on the binary channel; invoked from an npm/npx install
it prints the npm guidance from §4 instead of attempting to overwrite a file
inside `node_modules`.

### 6. Publishing a release writes the KV value automatically

The release process is the single writer of the KV `latest`/`min_supported`
value, so the API answer never lags the published artifact. The target end state
is **GitHub-driven**: when a CLI release is published (the GitHub
`release: published` event, fired when the draft from `cli-release.yml` is
promoted), an automation writes the new version to KV.

Two implementations, in order of preference:

1. **A workflow step / `release: published`-triggered Action** that runs
   `wrangler kv key put` (or hits a tiny authenticated admin write) for each env.
   This keeps the writer inside CI with the same credentials that already deploy
   Workers, and needs no public ingress. **Preferred** — start here.
2. **A GitHub webhook → `api` endpoint** (operator/admin-authenticated, in the
   `/admin/...` family per ADR 0046) that updates KV on `release` events. More
   moving parts (public webhook surface, signature verification); adopt only if
   the release automation must live outside GitHub Actions.

Because the value lives in KV, **neither path redeploys `api`** — both are a
single KV write. The implemented path is `cli-advertise.yml`: a
GitHub-hosted-runner publish job, triggered by `release: published`, publishes
npm via trusted publishing and writes preview + production KV. The CLI release
tag remains `cli-v<version>` and is derived from `apps/cli/package.json`; there
is intentionally no `push: tags` deployment trigger.

## Consequences

- The release process gains one obligation, discharged by §6: publishing a CLI
  release runs `cli-advertise.yml`, which writes the KV value. Manual
  `wrangler kv key put` is break-glass remediation only.
- npm `version` and the `cli-vX.Y.Z` release tag must stay lockstep; the release
  flow should derive one from the other rather than relying on convention.
- One new public, unauthenticated route widens the public API surface by a
  single read-only endpoint with no tenant data.
- The standalone binary becomes self-maintaining without a package manager,
  closing the worst staleness gap, while keeping mutation behind explicit
  consent.

## Alternatives considered

- **GitHub `releases/latest` redirect as the source** (what `install.sh` uses):
  no API work, no rate limit, but cannot force-upgrade or give telemetry, and
  splits the answer across GitHub (binary) and npm (npx/global). Rejected for
  the steady state; still the source `install.sh` and `upgrade` download _bytes_
  from.
- **npm registry as the source** for all channels: single source of truth for
  npm/npx, but the binary channel does not otherwise touch npm and gains no
  force-upgrade. Rejected.
- **Silent binary self-update**: most convenient, but surprise-mutating an
  executable is unsafe in CI and a supply-chain concern. Rejected (§4).
- **Runtime `package.json` read for the version**: no `package.json` next to the
  single-file binary. Rejected (§1).
