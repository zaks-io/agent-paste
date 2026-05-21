# scripts

Implementation scripts live here.

## Worktree Setup

### `setup-codex-worktree.mjs`

Sets up a fresh Codex worktree:

```sh
pnpm setup:codex
```

The script copies ignored `.env*` and `.dev.vars*` files from the primary Git worktree when it can find one, falling back to creating `.env` from `.env.example` if no real env file exists. It does not overwrite existing env files unless `--force` is passed.

Then it enables Corepack, activates the `pnpm` version from `package.json`, installs dependencies with the lockfile, and installs Lefthook hooks. If the active Node version does not match `.nvmrc`, the script tries to re-run itself through `nvm`.

Useful options:

```sh
pnpm setup:codex -- --source /path/to/source/worktree
pnpm setup:codex -- --dry-run
pnpm setup:codex -- --skip-install
```

## Hosted MVP Scripts

### `bootstrap-secrets.mjs`

First-deploy secret bootstrap for one environment.

Usage:

```sh
OPERATOR_EMAILS=you@example.com pnpm bootstrap:preview
node scripts/bootstrap-secrets.mjs production --operator-emails you@example.com
```

The script generates and writes the current MVP Worker secrets with `wrangler secret put`:

- `CONTENT_GATEWAY_SIGNING_KEY_V1`
- `CONTENT_SIGNING_SECRET`
- `UPLOAD_SIGNING_SECRET`
- `API_KEY_PEPPER_V1`
- `ADMIN_TOKEN_HASH`
- `OPERATOR_EMAILS`

It prints generated values once for password-manager capture, including the one-time `ADMIN_TOKEN`; only the HMAC is written to Cloudflare as `ADMIN_TOKEN_HASH`. It checks existing Worker secrets first and refuses to overwrite unless `--force` is passed and the operator types `overwrite <env> secrets`.

Use `--print-only` to verify generation shape without calling Wrangler.

### `migrate.mjs`

Migration runner command for preview/production:

```sh
PREVIEW_DATABASE_URL=postgres://... pnpm migrate:preview
PRODUCTION_DATABASE_URL=postgres://... pnpm migrate:production
```

The script exports the selected migration URL as `DATABASE_URL` and runs the committed MVP SQL migration from `packages/db`.

### `deploy-preview.mjs`

Preview/production deploy runner:

```sh
pnpm deploy:preview
pnpm deploy:production
```

It deploys hosted Workers in the MVP dependency order:

1. `api`
2. `upload`
3. `content`

The script shells out to Wrangler. It is intentionally not used by tests.

### `smoke-hosted.mjs`

Hosted smoke test:

```sh
AGENT_PASTE_PREVIEW_ADMIN_TOKEN=... pnpm smoke:preview
AGENT_PASTE_PRODUCTION_ADMIN_TOKEN=... pnpm smoke:production
```

Optional endpoint overrides:

- Preview URLs default to the shared `workers.dev` preview Workers.
- Production URLs default to `https://api.agent-paste.sh`, `https://upload.agent-paste.sh`, and `https://usercontent.agent-paste.sh`.
- PR preview URLs are provided by `.github/workflows/pr-preview.yml`.
- `AGENT_PASTE_SMOKE_PATH` defaults to `examples/local-harness/site`

Assertions:

- admin workspace/key bootstrap works
- CLI publish returns preview `view_url` and `agent_view_url`
- Agent View JSON returns the published artifact and file list
- browser Agent View HTML returns `text/html` and renders the artifact/file list
- content HTML returns the published fixture
- deleting the artifact makes the old content URL return `404`

### PR Preview Helpers

`create-hyperdrive.mjs`, `deploy-pr-preview.mjs`, and `cleanup-pr-preview.mjs` back the dynamic PR preview workflows. Each same-repo PR gets a Neon branch named `preview/pr-<number>`, PR-scoped Workers named `agent-paste-{api,upload,content}-pr-<number>`, and `workers.dev` URLs for smoke testing.
