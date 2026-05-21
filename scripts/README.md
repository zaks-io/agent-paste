# scripts

Implementation scripts live here.

## Preview MVP Scripts

### `bootstrap-secrets.mjs`

First-deploy secret bootstrap for one environment.

Usage:

```sh
OPERATOR_EMAILS=you@example.com pnpm bootstrap:preview
node scripts/bootstrap-secrets.mjs live --operator-emails you@example.com
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

Migration runner command for preview/live:

```sh
DATABASE_URL_MIGRATIONS_PREVIEW=postgres://... pnpm migrate:preview
node scripts/migrate.mjs live
```

The script exports the selected migration URL as `DATABASE_URL` and runs the committed MVP SQL migration from `packages/db`.

### `deploy-preview.mjs`

Preview/live deploy runner:

```sh
pnpm deploy:preview
pnpm deploy:live
```

It deploys the hosted preview Workers in the MVP dependency order:

1. `api`
2. `upload`
3. `content`

The script shells out to Wrangler. It is intentionally not used by tests.

### `smoke-preview.mjs`

Hosted preview smoke test:

```sh
AGENT_PASTE_PREVIEW_ADMIN_TOKEN=... pnpm smoke:preview
```

Optional endpoint overrides:

- `AGENT_PASTE_PREVIEW_API_URL` defaults to `https://api.preview.agent-paste.sh`
- `AGENT_PASTE_PREVIEW_UPLOAD_URL` defaults to `https://upload.preview.agent-paste.sh`
- `AGENT_PASTE_PREVIEW_CONTENT_URL` defaults to `https://usercontent.preview.agent-paste.sh`
- `AGENT_PASTE_SMOKE_PATH` defaults to `examples/local-harness/site`

Assertions:

- admin workspace/key bootstrap works
- CLI publish returns preview `view_url` and `agent_view_url`
- Agent View JSON returns the published artifact and file list
- browser Agent View HTML returns `text/html` and renders the artifact/file list
- content HTML returns the published fixture
- deleting the artifact makes the old content URL return `404`
