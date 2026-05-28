# scripts

Implementation and operations scripts live here. Root package scripts wrap the common entry points; call files here directly only when you need a lower-level option.

## Worktree Setup

### `setup-codex-worktree.mjs`

Sets up a fresh Codex worktree:

```sh
pnpm setup:codex
```

The script copies ignored `.env*` and `.dev.vars*` files from the primary Git worktree when it can find one, falling back to creating `.env` from `.env.example` if no real env file exists. It does not overwrite existing env files unless `--force` is passed.

Then it enables Corepack, activates the `pnpm` version from `package.json`, installs dependencies with the lockfile, and installs Lefthook hooks. If the active Node version does not match `.nvmrc`, the script first looks for an installed matching Node under `~/.nvm/versions/node`, re-runs itself with that absolute `node` binary, and prepends that Node's `bin` directory so child `pnpm` commands use the same runtime. If no matching local Node exists, it falls back to installing through `nvm`.

Useful options:

```sh
pnpm setup:codex -- --source /path/to/source/worktree
pnpm setup:codex -- --dry-run
pnpm setup:codex -- --skip-install
pnpm setup:codex -- --skip-env
```

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

- `CONTENT_SIGNING_SECRET`
- `UPLOAD_SIGNING_SECRET`
- `ARTIFACT_BYTES_ENCRYPTION_KEY` (upload, content, and jobs; same value on all three)
- `API_KEY_PEPPER_V1`
- `SMOKE_HARNESS_SECRET` (api preview/PR only; not production)
- `STREAM_INTERNAL_SECRET` (api and stream; stream-to-api live-update authorize)

It uses `wrangler secret list --format json` and refuses to write when listing fails or when secrets already exist (unless `--force`).

### `set-stream-internal-secret.mjs`

Targeted rollout for live-update internal auth only. Sets the same `STREAM_INTERNAL_SECRET` on `agent-paste-api-<target>` and `agent-paste-stream-<target>` without reading or rotating unrelated secrets.

```sh
node scripts/set-stream-internal-secret.mjs preview
node scripts/set-stream-internal-secret.mjs production --value <existing-secret>
node scripts/set-stream-internal-secret.mjs preview --dry-run
```

Use this for AP-80 / live-update rollout on existing hosted environments. First-deploy bootstrap can still mint `STREAM_INTERNAL_SECRET`, but operators should prefer this script when other Worker secrets are already present.

### `set-artifact-bytes-encryption-secret.mjs`

Targeted rollout for application-layer artifact-byte encryption only. Sets the same `ARTIFACT_BYTES_ENCRYPTION_KEY` on `agent-paste-upload-<target>`, `agent-paste-content-<target>`, and `agent-paste-jobs-<target>` without reading or rotating unrelated secrets.

```sh
node scripts/set-artifact-bytes-encryption-secret.mjs preview
node scripts/set-artifact-bytes-encryption-secret.mjs production --value <existing-secret>
node scripts/set-artifact-bytes-encryption-secret.mjs preview --dry-run
```

Use this for AP-32 rollout on existing hosted environments. First-deploy bootstrap mints the same secret; PR preview derives it from `PR_PREVIEW_SECRET_SEED` in `deploy-pr-preview.mjs`. Operators run this locally with `wrangler`; do not commit secret values.

With `--with-web`, bootstrap also writes:

- `WORKOS_API_KEY`
- `WORKOS_CLIENT_ID`
- `WORKOS_COOKIE_PASSWORD`

It prints generated values once for password-manager capture, including `SMOKE_HARNESS_SECRET` for non-production smoke harness routes. It checks existing Worker secrets first and refuses to overwrite unless `--force` is passed and the operator types `overwrite <env> secrets`.
Human operator access is controlled in WorkOS by granting the `admin` role slug to the user.

Use `--print-only` to verify generation shape without calling Wrangler. Use `--skip-web` to force CLI-first bootstrap even if WorkOS values are present.

### `migrate.mjs`

Migration runner command for preview/production (uses `platform_admin`, not Worker credentials):

```sh
DATABASE_URL_MIGRATIONS_PREVIEW=postgres://... pnpm migrate:preview
DATABASE_URL_MIGRATIONS_PRODUCTION=postgres://... pnpm migrate:production
```

The script exports the selected migration URL as `DATABASE_URL`, sets `DATABASE_RUNTIME_ROLE=app_role` for migrations that harden the runtime role, and runs the committed SQL migrations from `packages/db`. Hyperdrive configs must use `DATABASE_URL_RUNTIME_*` (`app_role`). See [`docs/ops/runbook-neon-database-roles.md`](../docs/ops/runbook-neon-database-roles.md).

### `deploy-preview.mjs`

Preview/production deploy runner:

```sh
pnpm deploy:preview
pnpm deploy:production
```

It ensures shared preview/production Cloudflare Queues exist (DLQs first), then deploys hosted Workers in dependency order:

1. `api`
2. `upload`
3. `content`
4. `jobs`
5. `apex`
6. `web`

Queue provisioning runs before `api` because the API and jobs Workers bind `bundle-generate-*` producers/consumers. The web deploy runs last because its service binding targets the deployed API Worker. `apps/web` builds with `CLOUDFLARE_ENV=<target>` so the Cloudflare/Vite plugin emits the target-specific deploy config.

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
- Production URLs default to `https://api.agent-paste.sh`, `https://upload.agent-paste.sh`, `https://usercontent.agent-paste.sh`, `https://agent-paste.sh`, and `https://app.agent-paste.sh`.
- PR preview URLs are provided by GitHub Actions workflow `.github/workflows/pr-preview.yml`.
- `AGENT_PASTE_SMOKE_PATH` defaults to `examples/local-harness/site`.

Assertions:

- smoke harness provisions a workspace and API key (preview/PR) or uses a pre-provisioned production key
- CLI publish returns content `view_url` and API `agent_view_url`
- Agent View JSON returns the published artifact and file list
- browser Agent View HTML returns `text/html` and renders the artifact/file list
- content HTML returns the published fixture
- deleting the artifact makes the old content URL return `404`
- preview/PR content Artifact Rate Limit returns `rate_limited_artifact`
- apex `/`, `/llms.txt`, `/agents.md`, and product-surface redirects behave without cookies
- web `/healthz` returns 200 and `/api/auth/sign-in` returns a WorkOS 307 when a web URL is configured

### `smoke-web-api.mjs`

Local web API smoke:

```sh
pnpm smoke:web
```

The script starts the local MVP server on alternate ports, stubs WorkOS locally, provisions a member through the web callback route, and verifies dashboard read APIs, key minting, settings, audit, API-key rejection on member routes, and cross-workspace not-found behavior.

### `lighthouse-dashboard-a11y.mjs`

Local Lighthouse accessibility gate for the authenticated `/dashboard` empty surface:

```sh
pnpm build
pnpm lighthouse:dashboard-a11y
```

The script builds on the same local harness pattern as `smoke-web-api.mjs`: mock WorkOS JWKS, the local MVP API/upload/content stack, and a built `@agent-paste/web` Worker via `wrangler dev`. It seals an AuthKit session cookie for a returning member with no published artifacts, asserts `/dashboard` renders authenticated chrome plus an empty overview, then runs Lighthouse with `onlyCategories: ['accessibility']`. The process exits non-zero when the score is below `95` (override with `AGENT_PASTE_LIGHTHOUSE_A11Y_MIN_SCORE`).

PR preview runs this step after Worker readiness. It does not depend on the
per-PR web deploy and therefore still runs when `WORKOS_PREVIEW_API_KEY` is
unset and web preview is skipped. The full hosted PR smoke is not part of the
default PR cycle; run `pnpm smoke:pr` manually when diagnosing a preview.

## PR Preview Helpers

`check-pr-preview-capacity.mjs`, `create-hyperdrive.mjs`, `deploy-pr-preview.mjs`, `cleanup-pr-preview.mjs`, `delete-neon-pr-branch.mjs`, `delete-github-pr-preview-environment.mjs`, and `resolve-neon-role-url.mjs` back the dynamic PR preview workflows. `check-pr-preview-capacity.mjs` runs before Neon branch creation and fails early when the account is already at the PR-preview Hyperdrive limit, so a quota problem does not leave a new orphaned Neon branch behind. After PR migrations run, `resolve-neon-role-url.mjs` prefers a Neon API `app_role` direct URL when Neon returns one with a password; for SQL-provisioned roles it falls back to building the URL from the workflow-provided `DATABASE_RUNTIME_ROLE_PASSWORD` and the owner/bootstrap host. `create-hyperdrive.mjs` receives that runtime URL only (for example `PR_DATABASE_URL`) and creates or updates the PR-scoped Hyperdrive config so reruns stay aligned with the current `app_role` password. Each same-repo PR gets:

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

Older workflow revisions created one GitHub Environment per PR using
`pr-preview-<number>`. Cleanup deletes those legacy records when
`PR_PREVIEW_ENVIRONMENT_CLEANUP_TOKEN` is set to a token with repository
Administration write permission; the default Actions `GITHUB_TOKEN` cannot grant
that permission.
