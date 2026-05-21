# First Deploy Runbook

This runbook is the operator checklist for the first deploy of an agent-paste environment. Run it separately for `preview` and `live`; secrets, buckets, KV namespaces, Hyperdrive configs, and Postgres instances are environment-scoped.

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
  DATABASE_URL_MIGRATIONS_PREVIEW=postgres://... pnpm migrate:preview
  ```

- Confirm workspace isolation is enforced by the repository queries for this MVP.
- Confirm the migration credential and Hyperdrive runtime credential are separate.

## Secret Bootstrap

Run `scripts/bootstrap-secrets.mjs` for the target environment. The script contract is tracked in [`scripts/README.md`](../../scripts/README.md). For preview:

```sh
OPERATOR_EMAILS=you@example.com pnpm bootstrap:preview
```

It generates and writes:

- `CONTENT_GATEWAY_SIGNING_KEY_V1`
- `CONTENT_SIGNING_SECRET`
- `UPLOAD_SIGNING_SECRET`
- `API_KEY_PEPPER_V1`
- `ADMIN_TOKEN_HASH`
- `OPERATOR_EMAILS`

The script prints the one-time `ADMIN_TOKEN` for operator use, but only writes `ADMIN_TOKEN_HASH` to Cloudflare. It must refuse to overwrite existing secrets unless `--force` and a typed confirmation are provided. Record generated values in the password manager before closing the terminal. Routine rotation uses the ADR 0045 rotation tooling, not this bootstrap script.

Set external provider secrets manually: Auth0 client values, Hyperdrive connection strings, and any provider-issued credentials that the bootstrap script cannot safely generate.

## Preview MVP Deploy Order

Run preview in this order:

```sh
pnpm migrate:preview
pnpm deploy:preview
AGENT_PASTE_PREVIEW_ADMIN_TOKEN=... pnpm smoke:preview
```

`pnpm deploy:preview` deploys only the preview MVP surface and keeps the order fixed:

1. Deploy `api`.
2. Deploy `upload`.
3. Deploy `content`.

`jobs`, `web`, and `mcp` are outside this preview MVP deploy script.

## Smoke Checks

The hosted smoke is intentionally CLI/admin-token based for MVP:

```sh
AGENT_PASTE_PREVIEW_ADMIN_TOKEN=... pnpm smoke:preview
```

It creates a workspace and API key, publishes `examples/local-harness/site`, verifies Agent View HTML for browsers, Agent View JSON for agents, content HTML through the content Worker, and finally deletes the artifact and asserts the old content URL returns `404`.
