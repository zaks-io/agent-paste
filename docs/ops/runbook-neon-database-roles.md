# Neon Database Roles And Credential Boundaries

Last updated: 2026-05-26 (AP-18).

Workers reach Postgres through Hyperdrive as `app_role` (`NOBYPASSRLS`). Schema migrations and other DDL run as `platform_admin` (`BYPASSRLS`) from GitHub Actions only. Migration connection strings must never be bound to Workers or Hyperdrive.

## Roles

| Role             | RLS                        | Used by                                      |
| ---------------- | -------------------------- | -------------------------------------------- |
| `app_role`       | `NOBYPASSRLS` (tenant RLS) | `api` and `upload` via Hyperdrive            |
| `platform_admin` | `BYPASSRLS`                | GitHub migration steps, narrow platform GUCs |
| `neondb_owner`   | Neon default owner         | One-time bootstrap only until roles exist    |

Migration `packages/db/migrations/0010_db_roles.sql` creates `app_role` and `platform_admin` as separate roles. Runtime `app_role` must not receive `platform_admin` or any other privilege that would let Workers bypass tenant RLS.

## Environment variables

| Variable                             | Scope        | Role / purpose                                            |
| ------------------------------------ | ------------ | --------------------------------------------------------- |
| `DATABASE_URL_MIGRATIONS_PREVIEW`    | Preview / PR | `platform_admin` direct URL for `pnpm migrate:preview`    |
| `DATABASE_URL_MIGRATIONS_PRODUCTION` | Production   | `platform_admin` direct URL for `pnpm migrate:production` |
| `DATABASE_URL_RUNTIME_PREVIEW`       | Preview      | `app_role` direct URL when updating preview Hyperdrive    |
| `DATABASE_URL_RUNTIME_PRODUCTION`    | Production   | `app_role` direct URL when updating production Hyperdrive |

Legacy names (`PREVIEW_DATABASE_URL`, `PRODUCTION_DATABASE_URL`) still work for migrations but log a deprecation warning. Do not point Hyperdrive at them.

Local development (`docker-compose`) may keep using the single `DATABASE_URL` superuser; Workers in `pnpm dev:all` use the in-memory repository.

## Hosted bootstrap order

1. Run migrations once with a role that can create roles (Neon `neondb_owner` or existing `platform_admin` URL) so `0010_db_roles.sql` applies.
2. In the Neon console, set passwords for `app_role` and `platform_admin` on the target branch (or rely on inherited branch passwords after they exist on `main`).
3. Store `platform_admin` direct URLs in GitHub Environment secrets as `DATABASE_URL_MIGRATIONS_*`.
4. Store `app_role` direct URLs locally for Hyperdrive maintenance as `DATABASE_URL_RUNTIME_*` (not required in GitHub unless a workflow updates Hyperdrive).
5. Update each environment Hyperdrive config to the `app_role` connection string (`node scripts/create-hyperdrive.mjs` or Wrangler dashboard). Preview/production IDs live in `apps/api/wrangler.jsonc` and `apps/upload/wrangler.jsonc`.
6. Remove migration URLs from any non-migration secret stores.

## PR preview workflow

`.github/workflows/pr-preview.yml` bootstraps in order:

1. Create the PR Neon branch with the default owner connection (`neondb_owner`).
2. Generate a preview-only `app_role` password (masked in logs) and pass it as `DATABASE_RUNTIME_ROLE_PASSWORD` only to the migrate and runtime-URL steps.
3. Run `node scripts/migrate.mjs preview` with the owner URL so `0010_db_roles.sql` can create roles and apply the preview password to `app_role` (SQL-created roles are not managed by Neon `reset_password`).
4. Build the `app_role` direct URL from the owner host plus `DATABASE_RUNTIME_ROLE_PASSWORD` via `scripts/resolve-neon-role-url.mjs` and pass it only to `scripts/create-hyperdrive.mjs`.

The owner/bootstrap URL is used only for migrations. Deploy steps never receive it. Once `platform_admin` exists on the shared preview/production branches, hosted migrate workflows should use `DATABASE_URL_MIGRATIONS_*` with that role instead of the owner URL.

## Verification

```sh
pnpm --filter @agent-paste/db test
pnpm verify
```

When credentials are available:

```sh
DATABASE_URL_MIGRATIONS_PREVIEW=postgres://... pnpm migrate:preview
# Confirm Hyperdrive config user is app_role (Wrangler / Cloudflare dashboard)
```

## Related docs

- [Hosted ops](./status/hosted-ops.md)
- [ADR 0044: workspace isolation via Postgres RLS](../adr/0044-workspace-isolation-via-postgres-rls.md)
- [ADR 0058: first-deploy schema and secret bootstrap](../adr/0058-first-deploy-schema-and-secret-bootstrap.md)
