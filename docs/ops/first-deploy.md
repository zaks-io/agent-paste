# First Deploy Runbook

This runbook is the operator checklist for the first deploy of an agent-paste environment. Run it separately for `preview` and `live`; secrets, buckets, KV namespaces, Auth0 apps, and Postgres instances are environment-scoped.

## Prerequisites

- Cloudflare account access with Workers, R2, KV, Queues, Hyperdrive, Access, and the `agent-paste.sh` routes configured.
- Auth0 tenant access with applications for `web`, `agent-paste CLI`, and `agent-paste MCP`.
- A Postgres database for the target environment.
- `wrangler` authenticated as the deploy operator.
- A password-manager entry ready for one-time secret capture.

## Auth0

- Create or verify the dashboard application used by `web`.
- Create the native `agent-paste CLI` application from [ADR 0060](../adr/0060-cli-authentication-via-auth0-loopback.md), with `http://127.0.0.1` as the loopback callback host and PKCE required.
- Create the `agent-paste MCP` application from [ADR 0061](../adr/0061-mcp-worker-with-oauth-only-via-auth0-dcr.md), enable Dynamic Client Registration, and install the redirect-URI allowlist Action.
- Configure the audiences:
  - `https://api.agent-paste.sh/v1`
  - `https://api.agent-paste.sh/v1/cli`
  - `https://mcp.agent-paste.sh`

## Cloudflare Resources

- Create R2 buckets for artifact bytes.
- Create KV namespaces for the content-token denylist.
- Create queues and DLQs from the jobs ADRs.
- Create Hyperdrive config for the environment Postgres database.
- Record resource IDs in the per-app Wrangler config; keep secret values out of the config.

## Database Bootstrap

- Run the first Drizzle migration as `platform_admin`.
- Confirm the migration created `app_role` with `NOBYPASSRLS`.
- Confirm tenant tables are born with RLS enabled and `workspace_id = current_setting('app.workspace_id', true)::uuid` policies.
- Confirm CI and Hyperdrive use separate database credentials.

## Secret Bootstrap

Run `scripts/bootstrap-secrets.ts` for the target environment once the script exists in the implementation tree. It generates and writes:

- `CONTENT_GATEWAY_SIGNING_KEY_V1`
- `ACCESS_LINK_SIGNING_KEY_V1`
- `API_KEY_PEPPER_V1`
- `OPERATOR_EMAILS`
- `WEB_SESSION_SEAL_KEY_V1`

The script must refuse to overwrite existing secrets unless `--force` and a typed confirmation are provided. Record generated values in the password manager before closing the terminal. Routine rotation uses the ADR 0045 rotation tooling, not this bootstrap script.

Set external provider secrets manually: Auth0 client values, Hyperdrive connection strings, and any provider-issued credentials that the bootstrap script cannot safely generate.

## Deploy Order

1. Deploy `api`.
2. Deploy `upload`.
3. Deploy `content`.
4. Deploy `jobs`.
5. Deploy `web`.
6. Deploy `mcp`.

## Smoke Checks

- Sign in through `web`; first sign-in creates a **Personal Workspace**, **Workspace Member**, default **Usage Policy**, and default **API Key**.
- Run `agent-paste login`, then `agent-paste whoami`.
- Publish a small folder through the CLI and verify the **Private Link**, **Revision Link**, **Agent View**, and content fetch.
- Resolve an **Access Link Signed URL** through `POST /v1/access-links/resolve` and verify the response includes `content_prefix`.
- Connect an MCP host through OAuth and run `whoami()` plus a text-only `publish_artifact`.
- Revoke an **Access Link** and verify old content-gateway URLs fail after denylist propagation or token expiry.
