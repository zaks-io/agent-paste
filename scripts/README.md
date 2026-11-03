# scripts

Implementation and operations scripts live here. Root package scripts wrap the common entry points; call files here directly only when you need a lower-level option.

## Testing policy

Decision logic belongs in `scripts/lib/` and is unit-tested by import (call the
exported function directly so v8 counts the coverage — `spawnSync` runs the code
in a child process the parent's coverage cannot see). Orchestrators and the
`smoke-*` scripts shell out to wrangler/gh/neon or boot real Workers; they are
integration scripts, exercised by `pnpm smoke:*`, and are deliberately out of the
`scripts/lib/**` unit-coverage scope in `vitest.scripts.config.ts`. Two harnesses
that live under `lib/` (`smoke-mcp-local.mjs`, `smoke-port.mjs`) are excluded for
the same reason — see the comment on the `coverage.exclude` list. With those
exclusions, `scripts/lib/` sits around 90% lines.

## Typing policy

These files stay plain ESM (`.mjs`) — no transpile in the deploy hot path — but the
decision-logic tier is type-checked via `// @ts-check` + JSDoc. `pnpm typecheck:scripts`
(`tsc -p tsconfig.scripts.json`, wired into `pnpm verify` and so into CI `Validate`)
checks the files listed in `tsconfig.scripts.json`: the deploy orchestrators plus the
pure `scripts/lib/` modules. The posture is relaxed (`noImplicitAny` off) so un-annotated
params don't force a `.ts` conversion — the goal is catching real bugs (a Map carrying a
stray field, a guard that didn't narrow), not 100% annotation coverage.

The smoke/integration scripts are out of this scope on purpose: they read
`await res.json()` (typed `unknown`) throughout, which is all false positives on the same
tier already excluded from unit coverage. To bring a new file under the gate, add
`// @ts-check` to it, list it in `tsconfig.scripts.json`, and make `pnpm typecheck:scripts`
pass.

## Security checks

`pnpm security:attest` runs the repository scanner bundle.
`node scripts/security-snyk.mjs` runs the separate Snyk workspace scan. Both
verify installed dependency patches before applying an exact advisory disposition
and build contract dependencies before running the structural request-array bounds
tests, so an install-only checkout can execute the checks.
The Snyk runner preserves raw reports and the policy decision under
`artifacts/security/snyk/`; scanner errors and incomplete workspace coverage fail
closed. Pure report decisions live in `lib/snyk-vulnerability-policy.mjs`; pnpm manifests
come from the native repository-relative `displayTargetFile` report field, never
from Snyk's synthetic package-name `path`. The runner pins Snyk CLI 1.1308.3;
`fixtures/snyk-workspaces.json` preserves the sanitized 30-workspace report shape
from the failed scheduled scan. Paths must be canonical expected manifests,
with no duplicate or missing workspace reports. `lib/zod-build-policy.mjs`
verifies the six build-only Zod paths and their reviewed config parsers.
`lib/zod-lighthouse-policy.mjs` verifies the Lighthouse Zod 3 chain before the
attestation disposes of its advisory.
`lib/picomatch-patch.mjs` verifies all active installed copies and locked paths
before Snyk can dispose of its repeated-extglob advisory. The patches reject
repeated extglobs; see [the mitigation contract](../docs/ops/security-todo.md#picomatch-repeated-extglob-mitigation).

## Worktree Setup

### `setup-worktree.mjs`

Sets up a fresh git worktree:

```sh
pnpm setup:worktree   # alias: pnpm setup:codex
```

The script copies ignored `.env*` and `.dev.vars*` files — including nested ones such as `apps/web/.dev.vars` — from the main checkout (the worktree that owns the shared `.git` directory) when it can find one, falling back to creating `.env` from `.env.example` if no real env file exists. It does not overwrite existing env files unless `--force` is passed. Override the source with `--source` or `WORKTREE_SETUP_SOURCE`.

Then it enables Corepack, activates the `pnpm` version from `package.json`, installs dependencies with the lockfile, and installs Lefthook hooks. If the active Node version does not match `.nvmrc`, the script first looks for an installed matching Node under `~/.nvm/versions/node`, re-runs itself with that absolute `node` binary, and prepends that Node's `bin` directory so child `pnpm` commands use the same runtime. If no matching local Node exists, it falls back to installing through `nvm`.

Useful options:

```sh
pnpm setup:worktree -- --source /path/to/source/worktree
pnpm setup:worktree -- --dry-run
pnpm setup:worktree -- --skip-install
pnpm setup:worktree -- --skip-env
```

## Local Cloudflare

`pnpm dev:cloudflare` runs the actual Workers on local workerd, with local
Postgres/Hyperdrive, persistent R2 and KV, queue consumers, Durable Objects,
native rate limits, and a WorkOS fixture. `pnpm smoke:local:cloudflare` checks the
running fleet end to end. Both commands use isolated configuration under
`.wrangler/local-cloudflare/`; they do not need hosted credentials.

See [the local development spec](../docs/specs/local-dev.md#local-cloudflare-runtime)
for ports, sandbox previews, persistence, and the pinned Wrangler/Miniflare
limitations handled by the launcher. The local smoke is separate from the fast
Node harness used by `pnpm smoke:local`.

## Hosted Scripts

### `bootstrap-secrets.mjs`

First-deploy secret bootstrap for one environment.

Preview CLI-first bootstrap:

```sh
pnpm bootstrap:preview
```

Production CLI-first bootstrap:

```sh
pnpm bootstrap:production
```

Web/AuthKit bootstrap includes WorkOS values:

```sh
node scripts/bootstrap-secrets.mjs preview \
  --with-web \
  --workos-api-key sk_... \
  --workos-client-id client_... \
  --workos-cookie-password "$(openssl rand -base64 32)"
```

The script writes Worker secrets with `wrangler secret put`. CLI-first secrets are:

- `CONTENT_SIGNING_SECRET` (api, upload, content, and jobs; same value on all four — jobs needs it for agent-view URL minting in the safety-scan handler)
- `UPLOAD_SIGNING_SECRET`
- `ARTIFACT_BYTES_ENCRYPTION_KEY` (api, upload, content, and jobs; same value on all four — api needs it for claim-time blob reparent)
- `API_KEY_PEPPER_V1`
- `SMOKE_HARNESS_SECRET` (api preview/PR only; not production)
- `STREAM_INTERNAL_SECRET` (api and stream; stream-to-api live-update authorize)

It uses `wrangler secret list --format json` and refuses to write when listing fails or when secrets already exist (unless `--force`).

With `--with-web`, bootstrap also writes:

- `WORKOS_API_KEY`
- `WORKOS_CLIENT_ID`
- `WORKOS_COOKIE_PASSWORD`

It prints generated values once for password-manager capture, including `SMOKE_HARNESS_SECRET` for non-production smoke harness routes. It checks existing Worker secrets first and refuses to overwrite unless `--force` is passed and the operator types `overwrite <env> secrets`.
Human operator access is controlled in WorkOS by granting the `admin` role slug to the user.

Use `--print-only` to verify generation shape without calling Wrangler. Use `--skip-web` to force CLI-first bootstrap even if WorkOS values are present.

### Secret application — `deploy.mjs` (ADR 0078)

Steady-state secret application is folded into the deploy. `scripts/deploy.mjs <local|preview|production>` is the one command:

- For each Worker it lists the secret **names** it already has (`wrangler secret list` — values are never readable) and provisions missing required symmetric secrets plus the optional agent-auth signing secret, generating values in memory and piping them to `wrangler secret bulk` over stdin. No value is ever printed or written to disk in cleartext.
- It then hands build + deploy to Turbo (`turbo run deploy:<target>`, which dependsOn `build`), so every workspace dependency is built in graph order (cached) before `wrangler deploy` runs. The content Worker deploys and passes readiness checks on both its exact signed-content host and its wildcard capability route before API and upload can mint URLs on that domain. Routing (which secret binds to which Worker) is the single source of truth in `lib/secret-routing.mjs`, and the same data backs each Worker's `secrets.required` in `wrangler.jsonc`, so a missing required secret fails the deploy.
- Preview-only `--app=<name>` (comma-separated) scopes both provisioning and the Turbo deploy to the selected Worker set (e.g. `--app=apex` for the marketing page); production deploys are full-fleet only. `--no-migrate` skips migrations. Migrations run automatically only when a DB-backed Worker (`api`, `upload`, `jobs`) is in scope.
- It is **idempotent**: a secret that already exists is left untouched, so re-running never rotates anything. Generation is the only way a value comes into being, and it goes straight from `randomBytes()` to the Worker.
- A value supplied under the canonical Worker binding name (for example `WORKOS_API_KEY` or `CF_ACCESS_AUD`) is used in preference to generating one. GitHub Environment selection provides the preview or production scope, so names never carry an environment prefix.
- `node scripts/deploy.mjs local` writes independent local-only values to a gitignored `.env` for `pnpm dev:all`; roll one by deleting its line and re-running.

Rotation is separate: use `rotate-versioned-secret.mjs` / `rotate-workos-secrets.mjs`. When using the `pnpm secrets:rotate:*` aliases, pass existing material with `--value-env <NAME>` instead of `--value` because pnpm echoes argv.

### `migrate.mjs`

Migration runner command for preview/production (uses the `neondb_owner` direct URL, not Worker credentials):

```sh
DATABASE_URL_MIGRATIONS_PREVIEW=postgres://... pnpm migrate:preview
DATABASE_URL_MIGRATIONS_PRODUCTION=postgres://... pnpm migrate:production
```

The script exports the selected migration URL as `DATABASE_URL`, sets `DATABASE_RUNTIME_ROLE=app_role` for migrations that harden the runtime role, and runs the committed SQL migrations from `packages/db`. Hyperdrive configs must use `DATABASE_URL_RUNTIME_*` (`app_role`). See [`docs/ops/runbook-neon-database-roles.md`](../docs/ops/runbook-neon-database-roles.md).

### `smoke-ci-postgres.mjs`

CI-local Postgres smoke:

```sh
DATABASE_URL=postgres://agent_paste:agent_paste@127.0.0.1:5432/agent_paste pnpm smoke:ci:postgres
```

The wrapper applies committed migrations once with the owner URL, sets an
`app_role` password through `DATABASE_RUNTIME_ROLE_PASSWORD`, runs the upload
lifecycle, transfer recovery, quota, map materialization and GC lock regression
suites against Postgres, then runs `smoke-local-mvp.mjs` with `AGENT_PASTE_LOCAL_DATABASE_BACKEND=postgres`. This
exercises the local CLI publish/delete/expiry/ephemeral path against real
Postgres roles and RLS without creating a Neon branch or Hyperdrive config.

### `smoke-local-transfers.mjs`

After building the API, Upload, Content, Jobs, Stream and CLI packages, run:

```sh
node scripts/smoke-local-transfers.mjs
```

The driver allocates five `transfer-*` ports with `sbx-runtime`, starts isolated
in-memory services, provisions a test workspace internally, and passes its key
only through the child environment. It runs `transfer-soak.mjs` with 250 MiB
files, both 1 GiB trees, acknowledged upload and persisted pull interruption,
150 updates, guarded partial sync, and three independent concurrent transfers.
Every downloaded file must match its source hash. CLI peak RSS must stay at or
below 400 MiB.

Additional HTTP fixtures verify pin/unpin, service after former expiry,
manifest expiry, cache revalidation, signed upload URL renewal, and competing
1 GiB reservations against a 1.5 GiB budget. `--fixtures-only` runs these smaller
fixtures without the large soak. The local capability proxy preserves the
published hostname when forwarding to Content, so the stable URL assertion
exercises real capability manifests rather than revision URLs.

Fixtures and private diagnostics stay in the allocated worktree state directory
on disk. Do not use RAM-backed `/tmp` for multi-gigabyte transfer output. The
driver stops its servers and leaves evidence for inspection. Never paste raw
CLI diagnostics or capability URLs into reports. Use the sanitized JSON summary.

These Node services use in-memory R2, database and always-allow rate-limit
bindings. They do not establish native Worker memory/CPU behavior, managed
gateway access, production rate limits, or preview browser acceptance. See
[validation evidence](../docs/ops/status/persistent-hosting-validation.md).

### `smoke-hosted-transfers.mjs`

The **PR Preview** workflow runs large hosted acceptance only when a
same-repository PR has both `full-pr-preview` and `large-transfer-preview`.
After integrating and pushing the change, add the second label to trigger the
normal preview deployment, database reset and acceptance run. Removing the label
skips large acceptance on subsequent runs. The ordinary workflow retains its
25-minute job deadline; opt-in runs allow 135 minutes overall and 110 minutes
for the transfer step, with a 105-minute soak subprocess deadline.

The existing deploy step supplies the masked scoped smoke secret within its
job. No secret is added to job outputs or artifacts. The driver provisions a
fresh owned workspace through `/__test__/provision-smoke`, verifies the key's
workspace, and passes that key to CLI and direct API calls. It runs the existing
soak with both full 1 GiB trees, 250 MiB files, upload/pull interruption,
150 updates and three concurrent transfers. It does not delete hosted fixtures.
Cleanup stays with the approved normal PR preview lifecycle.

All endpoints must be HTTPS PR Workers for the same PR and Workers account.
Signed reads must target that Content Worker; capability reads must use
`{capability}-pr-{number}.agent-paste.link`. The deployment routes that suffix
to this PR's Content Worker. The test refuses other origins, production hosts,
redirects and mismatched credentials. A scoped fetch preload reaches both the
soak and its CLI children. It honors native `Retry-After` responses for up to
four retries per request, at most 120 seconds per wait and five minutes per
request including waits. Missing, excessive or exhausted retry instructions
fail acceptance. Server limits are unchanged.

CI invokes the built driver directly:

```sh
node scripts/smoke-hosted-transfers.mjs
```

Required environment variables are `PR_NUMBER`, `AGENT_PASTE_PR_API_URL`,
`AGENT_PASTE_PR_UPLOAD_URL`, `AGENT_PASTE_PR_CONTENT_URL`,
`AGENT_PASTE_PR_SMOKE_HARNESS_SECRET`, and a disk-backed
`AGENT_PASTE_TRANSFER_OUTPUT_DIR`. The workflow also records `PR_HEAD_SHA` and
`GITHUB_SHA`. Do not extract the scoped secret to run from a sandbox; use the
workflow's existing secret delivery.

Only `hosted-transfer-evidence.json` is uploaded, with a seven-day retention.
It contains SHA/PR metadata, fixed outcome fields, fixture counts/bytes,
sanitized transfer/RSS counters, PUT content digests, Range checkpoints and retry counts. Child
stdout/stderr, raw soak reports, credentials and capability URLs remain in the
private runner directory. A failed soak preserves completed scenario identifiers,
the last command, allowlisted API error codes, exit codes and termination outcomes.
Streamed progress remains available when termination prevents the final report
from being written. Raw error messages are never uploaded. Hosted success must
be established by the actual CI run. Worker
telemetry, managed gateway, browser, expiry/renewal and quota/GC acceptance
remain separate checks listed in the report.

### Deploy build + ordering

`scripts/deploy.mjs` (above) migrates, provisions secrets, ensures shared Cloudflare
Queues exist (DLQs first), then runs phased `turbo run deploy:<target>` commands.
The content Worker deploys first and must pass its public readiness check before
the API and upload URL producers deploy. Turbo owns build order via the task graph
(`deploy:<target>` dependsOn `build`, `build` dependsOn `^build`), so every workspace
dependency is built before its Worker deploys. Per-env build switches reach only the package builds that need
them: `apps/apex` declares `AGENT_PASTE_ENV`, `BILLING_ENABLED`, and
`CF_WEB_ANALYTICS_TOKEN`; `apps/web` declares `CLOUDFLARE_ENV` and
`SENTRY_AUTH_TOKEN`. `apps/web` is built and deployed with
`CLOUDFLARE_ENV=<target>` so the Cloudflare/Vite plugin emits the target-specific
deploy config that `wrangler deploy` then reads.

Queue provisioning runs before the deploy because the API and jobs Workers bind
`bundle-generate-*` producers/consumers. Cloudflare service bindings (e.g.
`web` → `api`) resolve by name at request time, so deploy order between live Workers
is not a correctness gate.

### `smoke-hosted-ephemeral.mjs`

Hosted ephemeral publish smoke:

```sh
pnpm smoke:preview:ephemeral
pnpm smoke:pr:ephemeral
AGENT_PASTE_EPHEMERAL_SMOKE_WORKOS_ACCESS_TOKEN=... pnpm smoke:production:ephemeral
```

Targets: `preview`, `pr`, `production` (alias `live`). The script probes
`POST /v1/ephemeral/provision` before running. Provision probe failures,
including network errors, 5xx responses, rate-limit/gate failures, and
unexpected error codes, fail the smoke.

Assertions:

- rate-limited provision and ephemeral daily write allowance via API
- CLI `publish --ephemeral` on `examples/local-harness/ephemeral-site`, including
  Artifact and Revision IDs, the capability URL, expiry, and ephemeral claim
  fields
- the returned Artifact HTML, `noindex`, and script-disabled CSP
- Claim Token never appears in public URLs or stderr
- optional claim redemption when `AGENT_PASTE_EPHEMERAL_SMOKE_WORKOS_ACCESS_TOKEN` is set
- preview/PR cleanup via smoke harness `__test__/delete-artifact` when harness secret is present

PR preview runs this automatically in `.github/workflows/pr-preview.yml` after
Worker readiness.

### `smoke-hosted.mjs`

Hosted smoke test:

```sh
AGENT_PASTE_PREVIEW_SMOKE_HARNESS_SECRET=... pnpm smoke:preview
AGENT_PASTE_PRODUCTION_SMOKE_API_KEY=... pnpm smoke:production
```

Harness secrets (`scripts/smoke-hosted.mjs`):

- Preview: `AGENT_PASTE_PREVIEW_SMOKE_HARNESS_SECRET`, then `AGENT_PASTE_SMOKE_HARNESS_SECRET`.
- PR preview: `AGENT_PASTE_PR_SMOKE_HARNESS_SECRET`, then `AGENT_PASTE_PREVIEW_SMOKE_HARNESS_SECRET`.
- Local harness: `AGENT_PASTE_SMOKE_HARNESS_SECRET`, then `SMOKE_HARNESS_SECRET` (see `scripts/smoke-harness.mjs`).

Optional endpoint overrides:

- Preview URLs default to the shared preview Workers and domains.
- Production URLs default to `https://api.agent-paste.sh`, `https://upload.agent-paste.sh`, `https://usercontent.agent-paste.link`, `https://agent-paste.sh`, and `https://app.agent-paste.sh`.
- PR preview URLs are provided by GitHub Actions workflow `.github/workflows/pr-preview.yml`.
- `AGENT_PASTE_SMOKE_PATH` defaults to `examples/local-harness/site`.

Assertions:

- smoke harness provisions a workspace and API key (preview/PR) or uses a pre-provisioned production key
- CLI JSON publish returns `artifact_id`, `revision_id`, `title`, `url`, and `expires_at`
- hosted `url` is the Artifact root on its own capability subdomain
- content HTML returns the published fixture directly, without an app viewer or iframe
- deleting the artifact makes the old content URL return `404`
- preview/PR content Artifact Rate Limit returns `rate_limited_artifact` (serial GET burst; CF bindings are per-colo)
- apex `/`, `/llms.txt`, `/agents.md`, and product-surface redirects behave without cookies
- web `/healthz` returns 200 and `/api/auth/sign-in` returns a WorkOS 307 when a web URL is configured

### `smoke-web-api.mjs`

Local web API smoke:

```sh
pnpm smoke:web
```

The script starts the local MVP server on alternate ports, stubs WorkOS locally, provisions a member through the web callback route, and verifies dashboard read APIs, key minting, settings, audit, API-key rejection on member routes, and cross-workspace not-found behavior.

### `lighthouse-apex-a11y.mjs`

Local Lighthouse accessibility gate for every prerendered apex route:

```sh
pnpm --filter @agent-paste/apex build
pnpm lighthouse:apex-a11y
```

The script serves `apps/apex/dist/client` from a local static server, imports the
built apex route table, and runs Lighthouse with `onlyCategories:
['accessibility']` on each route. The process exits non-zero when any route is
below `100` (override with `AGENT_PASTE_LIGHTHOUSE_APEX_A11Y_MIN_SCORE`).

### `lighthouse-dashboard-a11y.mjs`

Local Lighthouse accessibility gate for the authenticated `/dashboard` empty surface:

```sh
pnpm build
pnpm lighthouse:dashboard-a11y
```

The script builds on the same local harness pattern as `smoke-web-api.mjs`: mock WorkOS JWKS, the local MVP API/upload/content stack, and a built `@agent-paste/web` Worker via `wrangler dev`. It seals an AuthKit session cookie for a returning member with no published artifacts, asserts `/dashboard` renders authenticated chrome plus an empty overview, then runs Lighthouse with `onlyCategories: ['accessibility']`. The process exits non-zero when the score is below `95` (override with `AGENT_PASTE_LIGHTHOUSE_A11Y_MIN_SCORE`).

Run this gate before deploying TanStack dependency updates. Unit tests and
typechecks do not exercise the built dashboard's query hydration. Router,
SSR query adapter and Query versions must be compatible; incompatible versions
can build successfully but return HTTP 500 for authenticated pages.

PR preview runs this step after Worker readiness. It does not depend on the
per-PR web deploy and therefore still runs when `WORKOS_PREVIEW_API_KEY` is
unset and web preview is skipped. The full hosted PR smoke is not part of the
default PR cycle; run `pnpm smoke:pr` manually when diagnosing a preview.

## PR Preview Helpers

`check-pr-preview-capacity.mjs`, `cleanup-stale-pr-previews.mjs`, `create-hyperdrive.mjs`, `deploy-pr-preview.mjs`, `cleanup-pr-preview.mjs`, `delete-neon-pr-branch.mjs`, `delete-github-pr-preview-environment.mjs`, and `resolve-neon-role-url.mjs` back the dynamic PR preview workflows. The workflow is opt-in: add the `full-pr-preview` label when a PR requires deployed Worker evidence, and remove it to trigger cleanup through `.github/workflows/pr-preview-cleanup.yml`. Default PR CI uses `smoke-ci-postgres.mjs` instead and does not create Neon or Hyperdrive resources. `cleanup-stale-pr-previews.mjs` discovers PR-scoped Workers, Queues, and Hyperdrive configs, checks the owning GitHub PR state, and deletes Workers, Queues, Hyperdrive configs, and Neon branches for closed or missing PRs before new preview creation and from the scheduled cleanup workflow. `check-pr-preview-capacity.mjs` then runs before Neon branch creation and fails early when the account is already at the PR-preview Hyperdrive limit, so a quota problem does not leave a new orphaned Neon branch behind. After PR migrations run, `resolve-neon-role-url.mjs` prefers a Neon API `app_role` direct URL when Neon returns one with a password; for SQL-provisioned roles it falls back to building the URL from the workflow-provided `DATABASE_RUNTIME_ROLE_PASSWORD` and the owner/bootstrap host. `create-hyperdrive.mjs` receives that runtime URL only (for example `PR_DATABASE_URL`) and creates or updates the PR-scoped Hyperdrive config so reruns stay aligned with the current `app_role` password. A labeled same-repo PR gets:

- a Neon branch named `preview/pr-<number>`
- PR-scoped Workers named `agent-paste-{api,upload,content,jobs,apex,web}-pr-<number>`
- PR-scoped rate-limit bindings including `ARTIFACT_RATE_LIMIT`
- `workers.dev` URLs for smoke testing
- an apex preview URL
- a fail-soft web preview when `WORKOS_PREVIEW_API_KEY` is available
- PR-scoped Cloudflare Queues for the jobs worker (`byte-purge-preview-pr-<number>`, etc.), created idempotently before jobs deploy and deleted on PR close

If the WorkOS preview API key is missing, `deploy-pr-preview.mjs` skips the per-PR web Worker rather than failing the API/upload/content/apex preview.
The GitHub Actions job uses the shared `Preview` GitHub Environment so preview
secrets and variables are assigned once, even though Cloudflare, Neon,
Hyperdrive, and queue resources stay PR-scoped.

The cleanup workflow still reacts to `pull_request.closed`, but it also runs a
six-hour reconciliation pass and supports manual `workflow_dispatch` without a
PR number to catch missed close events or duplicate PRs created from reused
branches.

Older workflow revisions created one GitHub Environment per PR using
`pr-preview-<number>`. Cleanup deletes those legacy records when
`PR_PREVIEW_ENVIRONMENT_CLEANUP_TOKEN` is set to a token with repository
Administration write permission; the default Actions `GITHUB_TOKEN` cannot grant
that permission.
