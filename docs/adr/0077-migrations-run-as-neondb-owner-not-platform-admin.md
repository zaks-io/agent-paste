# Migrations Run As The Neon Owner Role, Not `platform_admin`

[ADR 0058](./0058-first-deploy-schema-and-secret-bootstrap.md) and [ADR 0044](./0044-workspace-isolation-via-postgres-rls.md) both state that schema migrations run as `platform_admin`. That was the intended design; it is not what the deployed system does. Every real migration path runs as the Neon **owner** role (`neondb_owner`), and `platform_admin` is not the owner of any table on any branch. This ADR records the actual model so the docs stop describing a path nothing uses, and narrows the earlier ADRs' migration-runner claim without disturbing the parts of them that are still true.

This was found while fixing [AP-119](https://linear.app/zaks-io/issue/AP-119): a migration URL set to `platform_admin` authenticated fine but failed on the first ownership-only DDL statement (`ALTER TABLE api_keys` → `42501 must be owner of table api_keys`), because `platform_admin` holds `GRANT ALL` but is not the table owner.

## What is actually true

- **The Neon owner role runs migrations in every environment.**
  - Production: the `Production` GitHub environment's only database secret is `PRODUCTION_DATABASE_URL`, which is the `neondb_owner` connection. There is no `DATABASE_URL_MIGRATIONS_PRODUCTION` secret.
  - PR previews: `.github/workflows/pr-preview.yml` migrates with the Neon branch's owner URL (commented in the workflow as "Bootstrap migrations with the Neon owner URL until platform_admin exists on the project").
  - Standing preview / local: `pnpm migrate:preview` resolves to `PREVIEW_DATABASE_URL` (the `neondb_owner` connection to the `preview` Neon branch), mirroring how production uses `PRODUCTION_DATABASE_URL`.
- **`platform_admin` is not the owner of any table.** On both the `main` and `preview` Neon branches all public tables are owned by `neondb_owner`. `platform_admin` exists (created by `0010_db_roles.sql`) with `BYPASSRLS` and `GRANT ALL`, but `GRANT ALL` does not confer ownership, and Postgres restricts a class of DDL (`ALTER TABLE`, `DROP`, ownership changes) to the owner or a superuser. So `platform_admin` cannot run those statements.
- **`DATABASE_URL_MIGRATIONS_*` is the canonical env name, the legacy `*_DATABASE_URL` names are what is in use.** `packages/db/scripts/credentials.mjs` resolves the canonical name first and falls back to the legacy name, emitting a cosmetic deprecation warning. Because the deployed reality is the legacy `neondb_owner` URLs, that warning fires on every real migration, including production.

## What does _not_ change

- **`platform_admin` keeps its runtime role.** [ADR 0044](./0044-workspace-isolation-via-postgres-rls.md) uses `platform_admin` at request time through `withPlatformContext()` / `SET LOCAL ROLE platform_admin` for the narrow cross-tenant reads (Access Link / Agent View resolve) and the `jobs` cross-workspace sweeps. That is unaffected; this ADR is only about which role _applies migrations_, not which role serves privileged reads.
- **`app_role` is unchanged.** Workers still reach Postgres as `app_role` (`NOBYPASSRLS`) through Hyperdrive. Migrations using the owner role do not weaken tenant RLS, which `app_role` is still subject to.
- **The migration tooling and expand/contract discipline** from [ADR 0007](./0007-database-migrations-and-preview-environments.md) are unchanged. Only the connecting role differs from what 0058 described.

## Considered Options

- **Adopt `platform_admin` for real (make it the owner).** Reassign ownership of every public table and sequence to `platform_admin` on all branches, set and manage its password per branch, and point the migration secrets at it. This matches the original 0058/0044 wording and gives migrations a dedicated, RLS-bypassing, non-owner-of-default role. Cost: `platform_admin` was created by SQL (`0010_db_roles.sql`), so its password is not Neon-managed and does not propagate across branches; every branch (including ephemeral PR branches) would need ownership reassignment and password management wired into bootstrap. For a two-environment, one-operator MVP that is real recurring work for a boundary the owner role already provides at migration time (migrations are not request-path and not tenant-scoped). Deferred, not rejected — revisit if migrations ever need to run from a credential that must not be the database owner.
- **Document the `neondb_owner` reality (chosen).** Record that migrations run as the Neon owner role, keep `platform_admin` for its runtime cross-tenant role, and let the credential resolver keep its canonical-then-legacy fallback. Lowest-cost path that makes the docs match the system and removes the trap that a well-meaning `platform_admin` migration URL silently breaks on ownership DDL.

## Consequences

- **[ADR 0058](./0058-first-deploy-schema-and-secret-bootstrap.md) is amended:** the claim "Migrations run as `platform_admin`" in its _Schema and roles_ section is superseded by this ADR. The first migration still _creates_ both roles; what changed is that the migration _runner_ connects as the Neon owner, not `platform_admin`.
- **[ADR 0044](./0044-workspace-isolation-via-postgres-rls.md) is amended:** "Schema migrations run as `platform_admin`" is superseded by this ADR. The `platform_admin` _runtime_ usage in that ADR stands.
- **The migration-target branch must still match the runtime branch.** Independent of the role, the migration URL's Neon branch and the env's Hyperdrive origin branch must be the same, enforced by the pre-flight guard in `scripts/lib/hyperdrive-branch-guard.mjs` ([AP-119](https://linear.app/zaks-io/issue/AP-119)). The guard compares Neon endpoint ids; it is orthogonal to which role authenticates.
- **`docs/ops/runbook-neon-database-roles.md` is updated** to describe the owner-role migration reality, the canonical-vs-legacy env resolution, and the branch guard.
- **No code change is required.** The credential resolver already falls back to the legacy owner URLs; the deprecation warning is cosmetic.

## What this ADR is not

- Not a removal of `platform_admin`. The role stays for its [ADR 0044](./0044-workspace-isolation-via-postgres-rls.md) runtime purpose.
- Not the branch-alignment decision. That is the [AP-119](https://linear.app/zaks-io/issue/AP-119) guard, referenced above.
