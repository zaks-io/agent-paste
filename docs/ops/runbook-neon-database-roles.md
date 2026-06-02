# Neon Database Roles And Credential Boundaries

Last updated: 2026-06-02 (AP-119).

Workers reach Postgres through Hyperdrive as `app_role` (`NOBYPASSRLS`). Schema migrations and other DDL run as the Neon owner role (`neondb_owner`) from GitHub Actions only — see [ADR 0077](../adr/0077-migrations-run-as-neondb-owner-not-platform-admin.md). Migration connection strings must never be bound to Workers or Hyperdrive.

> **Migration role reality ([ADR 0077](../adr/0077-migrations-run-as-neondb-owner-not-platform-admin.md)).** Although `0010_db_roles.sql` creates `platform_admin` and earlier ADRs intended it to be the migration runner, migrations actually run as `neondb_owner` in every environment, because `platform_admin` holds `GRANT ALL` but is not the _owner_ of any table and so cannot run ownership-only DDL (`ALTER TABLE`, `DROP`) — attempting it fails with `42501 must be owner of table ...`. `platform_admin` is still used at _runtime_ for the narrow cross-tenant reads and `jobs` sweeps in [ADR 0044](../adr/0044-workspace-isolation-via-postgres-rls.md). Do not set a migration URL to `platform_admin` expecting it to work.

## Roles

| Role             | RLS                        | Used by                                                               |
| ---------------- | -------------------------- | --------------------------------------------------------------------- |
| `app_role`       | `NOBYPASSRLS` (tenant RLS) | `api` and `upload` via Hyperdrive                                     |
| `platform_admin` | `BYPASSRLS`                | Runtime cross-tenant reads / `jobs` sweeps (ADR 0044); not migrations |
| `neondb_owner`   | Neon default owner         | The migration runner in every environment (ADR 0077); table owner     |

Migration `packages/db/migrations/0010_db_roles.sql` creates `app_role` and `platform_admin` as separate roles. Runtime `app_role` must not receive `platform_admin` or any other privilege that would let Workers bypass tenant RLS.

## Environment variables

`scripts/migrate.mjs` resolves the migration URL via `packages/db/scripts/credentials.mjs`: the canonical `DATABASE_URL_MIGRATIONS_*` name wins if set, otherwise it falls back to the legacy `*_DATABASE_URL` name (logging a cosmetic deprecation warning). In the deployed system the legacy `neondb_owner` URLs are what is in use, so that warning fires on every real migration, including production.

| Variable                             | Scope        | Role / purpose                                                         |
| ------------------------------------ | ------------ | ---------------------------------------------------------------------- |
| `PREVIEW_DATABASE_URL`               | Preview / PR | `neondb_owner` direct URL — what `pnpm migrate:preview` uses today     |
| `PRODUCTION_DATABASE_URL`            | Production   | `neondb_owner` direct URL — the only DB secret in the `Production` env |
| `DATABASE_URL_MIGRATIONS_PREVIEW`    | Preview / PR | Canonical name; if set it overrides the legacy URL (currently unset)   |
| `DATABASE_URL_MIGRATIONS_PRODUCTION` | Production   | Canonical name; no such secret exists today                            |
| `DATABASE_URL_RUNTIME_PREVIEW`       | Preview      | `app_role` direct URL when updating preview Hyperdrive                 |
| `DATABASE_URL_RUNTIME_PRODUCTION`    | Production   | `app_role` direct URL when updating production Hyperdrive              |

Do not point Hyperdrive at any migration URL. If a `DATABASE_URL_MIGRATIONS_*` value is set, it must point at the same Neon branch as that environment's Hyperdrive origin; the `pnpm migrate:*` pre-flight guard (`scripts/lib/hyperdrive-branch-guard.mjs`) refuses to migrate on a branch mismatch.

Local development (`docker-compose`) may keep using the single `DATABASE_URL` superuser; Workers in `pnpm dev:all` use the in-memory repository.

## Hosted bootstrap order

1. Run migrations once with a role that can create roles (Neon `neondb_owner` or existing `platform_admin` URL) so `0010_db_roles.sql` applies.
2. In the Neon console, set passwords for `app_role` and `platform_admin` on the target branch (or rely on inherited branch passwords after they exist on `main`).
3. Store the `neondb_owner` direct URL in GitHub Environment secrets as `PRODUCTION_DATABASE_URL` / `PREVIEW_DATABASE_URL` (the migration runner per [ADR 0077](../adr/0077-migrations-run-as-neondb-owner-not-platform-admin.md)). The canonical `DATABASE_URL_MIGRATIONS_*` names are reserved for if/when migrations move to a dedicated owner role; if set, they must point at the same branch as that environment's Hyperdrive.
4. Store `app_role` direct URLs locally for Hyperdrive maintenance as `DATABASE_URL_RUNTIME_*` (not required in GitHub unless a workflow updates Hyperdrive).
5. Update each environment Hyperdrive config to the `app_role` connection string (`node scripts/create-hyperdrive.mjs` or Wrangler dashboard). Preview/production IDs live in `apps/api/wrangler.jsonc` and `apps/upload/wrangler.jsonc`.
6. Remove migration URLs from any non-migration secret stores.

## PR preview workflow

`.github/workflows/pr-preview.yml` bootstraps in order:

1. Create the PR Neon branch with the default owner connection (`neondb_owner`).
2. Generate a preview-only `app_role` password (masked in logs) and pass it as `DATABASE_RUNTIME_ROLE_PASSWORD` only to the migrate and runtime-URL steps.
3. Run `node scripts/migrate.mjs preview` with the owner URL so `0010_db_roles.sql` can create roles and apply the preview password to `app_role` (SQL-created roles are not managed by Neon `reset_password`).
4. Build the `app_role` direct URL from the owner host plus `DATABASE_RUNTIME_ROLE_PASSWORD` via `scripts/resolve-neon-role-url.mjs` and pass it only to `scripts/create-hyperdrive.mjs`.

The owner/bootstrap URL is used only for migrations. Deploy steps never receive it. The `neondb_owner` URL stays the migration runner per [ADR 0077](../adr/0077-migrations-run-as-neondb-owner-not-platform-admin.md); migrations are not moved to `platform_admin` unless that role is also made the table owner on every branch.

## Migration / Hyperdrive branch guard

`DATABASE_URL_MIGRATIONS_*` (where migrations are applied) and the Hyperdrive binding in `apps/api/wrangler.jsonc` (where the Workers read) point at a Neon branch independently. Nothing forces them onto the same branch, so a mismatch silently applies migrations to a database the runtime never reads. That is exactly what happened when `migrate:preview` targeted the `main` branch while preview Hyperdrive read the `preview` branch — `provision-smoke` failed because the runtime DB was missing columns the migration had added elsewhere.

`scripts/migrate.mjs` now runs a pre-flight guard (`scripts/lib/hyperdrive-branch-guard.mjs`) before every migration:

1. Reads the Hyperdrive binding `id` for the target env from `apps/api/wrangler.jsonc`.
2. Runs `wrangler hyperdrive get <id>` and extracts the Neon endpoint id from `origin.host` (no password is exposed).
3. Compares it to the endpoint id parsed from the migration URL's host (pooled vs direct hosts for the same branch share an endpoint id; the `-pooler` infix is normalized away).
4. Refuses to migrate when they differ, naming both endpoints.

If you intentionally migrate a branch Hyperdrive does not serve (e.g. bootstrapping a fresh branch before repointing Hyperdrive), set `SKIP_HYPERDRIVE_BRANCH_GUARD=1`. To clear a real divergence, repoint `DATABASE_URL_MIGRATIONS_<ENV>` at the Hyperdrive branch (or update the Hyperdrive origin via `scripts/create-hyperdrive.mjs`) so both endpoints match, then retry.

## Verification

```sh
pnpm --filter @agent-paste/db test
pnpm verify
```

When credentials are available:

```sh
# Uses PREVIEW_DATABASE_URL (neondb_owner) unless DATABASE_URL_MIGRATIONS_PREVIEW is set.
# The pre-flight guard refuses to run if the target branch != the preview Hyperdrive branch.
pnpm migrate:preview
# Confirm Hyperdrive config user is app_role (Wrangler / Cloudflare dashboard)
```

## Related docs

- [Hosted ops](./status/hosted-ops.md)
- [ADR 0044: workspace isolation via Postgres RLS](../adr/0044-workspace-isolation-via-postgres-rls.md)
- [ADR 0058: first-deploy schema and secret bootstrap](../adr/0058-first-deploy-schema-and-secret-bootstrap.md)
- [ADR 0077: migrations run as the Neon owner role, not platform_admin](../adr/0077-migrations-run-as-neondb-owner-not-platform-admin.md)
