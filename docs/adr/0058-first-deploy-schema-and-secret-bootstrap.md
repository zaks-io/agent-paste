# First-Deploy Schema and Secret Bootstrap

The first time agent-paste is deployed to an environment, two things have to exist before any Worker can serve a request: the Postgres schema with its two roles, and the shared secrets that `api`, `upload`, `content`, and `jobs` read from `env`. Both bootstraps run once per environment, are scripted, and produce artifacts that the steady-state operations described in [ADR 0007](./0007-database-migrations-and-preview-environments.md), [ADR 0044](./0044-workspace-isolation-via-postgres-rls.md), [ADR 0045](./0045-secret-rotation-cadence-and-on-demand-tooling.md), and [ADR 0046](./0046-operator-identity-and-web-admin-surface.md) take over.

## Considered Options

- **Terraform or Pulumi for the whole bootstrap.** Conventional infra-as-code for the roles, Worker secret values, KV namespace IDs, R2 buckets, and Hyperdrive config. Full state file, drift detection, the works. Real value at scale. For a two-environment MVP run by one person, the state file becomes a second thing to back up and protect, the secret values either live in state (bad) or are passed in out of band (defeats the point), and the existing `wrangler secret put` + Drizzle path already does what we need. Rejected for MVP; revisit if the resource count grows.
- **Apply schema and roles from a Worker on startup.** Self-bootstrapping Worker. Trades one cold-start hazard for several: `CREATE ROLE` requires elevated DB credentials the Worker should not hold continuously, and concurrent Workers race each other. Rejected.
- **Manual `psql` and `wrangler secret put` from a runbook.** Cheapest possible. Each operator types commands from a checklist. One typo in the role grant set is a tenant-isolation hole that no test will catch until something breaks. Rejected because the failure mode is too dangerous for the boundary it is creating.
- **Drizzle migrations for schema and roles, a checked-in TypeScript script for secrets (chosen).** Schema and role grants ride the same migration tooling as every later change, so the bootstrap step is just "the first migration". Secret generation is a script with deterministic structure so the operator does not invent key formats by hand; the script writes to Worker secrets via `wrangler secret put` and prints values for one-time capture into a password manager.

## Consequences

### Schema and roles

- **The first Drizzle migration creates the two DB roles** referenced by [ADR 0044](./0044-workspace-isolation-via-postgres-rls.md): `app_role` (`NOBYPASSRLS`, the role Workers reach through Hyperdrive) and `platform_admin` (`BYPASSRLS`, used inside `withPlatformContext()` and for migrations). `app_role` is granted `USAGE` on the public schema and `SELECT, INSERT, UPDATE, DELETE` on every tenant table at creation time; new tenant tables added by later migrations include the same grants in the migration that creates them.
- **Migrations run as `platform_admin`** from GitHub Actions per [ADR 0007](./0007-database-migrations-and-preview-environments.md). The DB connection string used by CI is a separate credential from the one Hyperdrive uses to reach `app_role`; CI does not need the Hyperdrive route.
- **RLS is enabled in the same migration that creates each tenant table**, with the `USING (workspace_id = current_setting('app.workspace_id', true)::uuid)` predicate from ADR 0044. There is no later "turn on RLS" migration; tables are born with it.
- **`preview` and `production` are bootstrapped by the same migration set** against different Postgres instances. PR preview branches from ADR 0007 inherit the roles from their parent branch; per-PR workflows do not re-create roles outside migrations.

### Secrets

- **`scripts/bootstrap-secrets.ts` is the one-time generator.** It runs locally on an operator's machine and emits cryptographically random values for the secrets that have no other source of truth:
  - `CONTENT_SIGNING_SECRET` (HMAC-SHA-256 secret for [ADR 0028](./0028-signed-url-tokens-for-content-gateway-authorization.md) tokens; bound on `api` and `upload` for mint, on `content` for verify).
  - `ACCESS_LINK_SIGNING_KEY_V1` (HMAC-SHA-256 secret for [ADR 0047](./0047-access-link-signed-url-with-fragment-encoded-payload.md) signed URLs; bound on `api` for both mint and resolve).
  - `API_KEY_PEPPER_V1` (per [ADR 0043](./0043-bearer-credential-format-and-storage.md); bound on `api`).
  - `OPERATOR_EMAILS` (the comma-separated allowlist from [ADR 0046](./0046-operator-identity-and-web-admin-surface.md); bound on `api`).
  - `WEB_SESSION_SEAL_KEY_V1` (AES-GCM key sealing the `__agp_session` cookie per [ADR 0059](./0059-web-app-session-and-auth-forwarding-to-api.md); bound on `web`).
- **Push path.** The script invokes `wrangler secret put` against the target environment for each value, then prints the raw values to stdout exactly once with a banner instructing the operator to record them in 1Password before closing the terminal. After the script exits the values exist only inside Cloudflare and inside the password manager.
- **External secrets are set out-of-band, not by the bootstrap script.** Auth0 client ID and secret, Hyperdrive connection string, R2 access credentials, and KV namespace IDs are configured through the relevant provider consoles and committed to `wrangler.jsonc` (IDs) or set as Worker secrets manually. The script does not touch them because it does not have credentials for those providers.
- **The `V1` suffix on signing-key names is the `kid` from ADR 0047.** Rotation per [ADR 0045](./0045-secret-rotation-cadence-and-on-demand-tooling.md) introduces `V2` alongside `V1` and drops `V1` after the overlap window. The bootstrap script never sees `V2`; rotation tooling owns that path. The ADR 0028 `kid` is carried by the `CONTENT_SIGNING_KID` Worker var rather than embedded in the secret name.

### Operator and environment scoping

- **Two environments, two bootstraps.** `preview` and `production` are bootstrapped independently. Secret values are not shared across environments; preview gets its own freshly-generated set so a leaked preview secret cannot forge production signatures.
- **Re-running the bootstrap script is a destructive operation.** Re-running it would generate fresh secret values and silently invalidate every issued token, signed URL, and API Key in that environment. The script refuses to run if any of the target secrets already exist on the target environment, requiring an explicit `--force` flag and a typed confirmation. Routine rotation goes through the rotation tooling from ADR 0045, not the bootstrap script.

### What this ADR is not

- Not a runbook. The exact command sequence lives in [`docs/ops/first-deploy.md`](../ops/first-deploy.md); the secret generator lives at `scripts/bootstrap-secrets.ts`.
- Not the rotation path. ADR 0045 owns rotation; the bootstrap script is `kid=V1` only.
- Not Auth0, Cloudflare account, or domain setup. Those happen before this script runs and are vendor-console work.
