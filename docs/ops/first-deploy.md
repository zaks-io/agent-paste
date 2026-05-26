# First Deploy Runbook

This runbook is the operator checklist for the first deploy of an agent-paste environment. Run it separately for shared `preview` and `production`; secrets, buckets, KV namespaces, Hyperdrive configs, and Postgres instances are environment-scoped.

## Prerequisites

- Cloudflare account access with Workers, R2, KV, Hyperdrive, and the `agent-paste.sh` routes configured.
- A Postgres database for the target environment.
- `wrangler` authenticated as the deploy operator.
- A password-manager entry ready for one-time secret capture.

## Cloudflare Resources

- Create R2 buckets for artifact bytes.
- Create KV namespaces for the content-token denylist.
- Create Hyperdrive config for the environment Postgres database.
- Record resource IDs in the per-app Wrangler config; keep secret values out of the config.

## Database Bootstrap

- Run the first MVP migration with a database role allowed to create tables:

  ```sh
  PREVIEW_DATABASE_URL=postgres://... pnpm migrate:preview
  PRODUCTION_DATABASE_URL=postgres://... pnpm migrate:production
  ```

- Confirm workspace isolation is enforced by the repository queries for this MVP.
- Confirm the migration credential and Hyperdrive runtime credential are separate.

## Secret Bootstrap

Run `scripts/bootstrap-secrets.mjs` for the target environment. The script contract is tracked in [`scripts/README.md`](../../scripts/README.md). For preview:

```sh
pnpm bootstrap:preview
```

It generates and writes:

- `CONTENT_SIGNING_SECRET`
- `UPLOAD_SIGNING_SECRET`
- `API_KEY_PEPPER_V1`
- `SMOKE_HARNESS_SECRET` (preview/production non-prod smoke only; not an operator credential)

The script prints one-time values for operator custody where applicable. It must refuse to overwrite existing secrets unless `--force` and a typed confirmation are provided. Record generated values in the password manager before closing the terminal. Routine rotation uses the ADR 0045 rotation tooling, not this bootstrap script.

Set external provider secrets manually: WorkOS values, Hyperdrive connection strings, and any provider-issued credentials that the bootstrap script cannot safely generate. Human operator access is assigned in WorkOS by granting the `admin` role slug to the user.

## Hosted MVP Deploy Order

Run an environment in this order:

```sh
pnpm migrate:preview
pnpm deploy:preview
AGENT_PASTE_PREVIEW_SMOKE_HARNESS_SECRET=... pnpm smoke:preview

pnpm migrate:production
pnpm deploy:production
AGENT_PASTE_PRODUCTION_SMOKE_API_KEY=... pnpm smoke:production
```

`pnpm deploy:preview` and `pnpm deploy:production` deploy only the MVP surface and keep the order fixed:

1. Deploy `api`.
2. Deploy `upload`.
3. Deploy `content`.

`jobs`, `web`, and `mcp` are outside this MVP deploy script.

## Smoke Checks

Preview/PR smokes provision a workspace through the non-production harness secret; production smokes use a pre-provisioned API key secret:

```sh
AGENT_PASTE_PREVIEW_SMOKE_HARNESS_SECRET=... pnpm smoke:preview
AGENT_PASTE_PRODUCTION_SMOKE_API_KEY=... pnpm smoke:production
```

Each smoke publishes `examples/local-harness/site`, verifies Agent View and content routes, and (non-production) deletes the artifact and asserts the old content URL returns `404`.

## Dynamic PR Previews

Same-repo PRs use `.github/workflows/pr-preview.yml`. The workflow creates a Neon branch named `preview/pr-<number>` from `main`, runs migrations against that branch URL, creates a PR-scoped Hyperdrive config, deploys `agent-paste-{api,upload,content}-pr-<number>` Workers to `workers.dev`, runs the hosted smoke, and comments the URLs on the PR. `.github/workflows/pr-preview-cleanup.yml` deletes the Workers, Hyperdrive config, and Neon branch when the PR closes.

Required GitHub Actions values:

- Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `NEON_API_KEY`, `PRODUCTION_DATABASE_URL`, `AGENT_PASTE_PRODUCTION_SMOKE_API_KEY`, `TURBO_REMOTE_CACHE_SIGNATURE_KEY`.
- Variables: `NEON_PROJECT_ID`, `CLOUDFLARE_WORKERS_SUBDOMAIN=isaac-a46`, `TURBO_TEAM`.
- Environment: `Production` on the production deploy job, with reviewer approval enabled in GitHub settings.
