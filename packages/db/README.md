# db

Drizzle schema, migrations, repository adapters, and query helpers.

Responsibilities:

- Postgres table definitions.
- RLS policies in migrations.
- RLS coverage gate for every `workspace_id` table.
- Migration scripts.
- Transaction helpers.
- Tenant-scoped Postgres repository helpers.
- Local in-memory repository for tests and the local MVP harness.
- API key generation and verification.

Schema target: [`docs/specs/data-model.md`](../../docs/specs/data-model.md).

## Checks

- `pnpm --filter @agent-paste/db db:check` verifies the Drizzle schema snapshot
  and runs a PGlite migration pass that asserts every `workspace_id` table has
  forced RLS and a tenant policy tied to `app.workspace_id`.

- `pnpm smoke:ci:postgres` migrates the disposable PostgreSQL database, then
  runs the delete-only upload lifecycle regression through `postgres-js` and
  `app_role` before the HTTP smoke. Set `DATABASE_URL` (owner) and
  `DATABASE_RUNTIME_ROLE_PASSWORD` for the disposable database. The runner
  derives the runtime URL, or accepts `DATABASE_URL_RUNTIME_CI`.
- The ordinary DB suite runs the same regression with PGlite. To run only the
  real PostgreSQL regression after migrating a disposable database:
  `AGENT_PASTE_POSTGRES_TEST_URL=<app_role-url> pnpm --filter @agent-paste/db exec vitest run src/repository/upload-session-delete-only.postgres.test.ts`.
  This test creates its own workspace; it is intended only for disposable test
  databases. The smoke runner also tests migration reapplication and interrupted
  validation in an isolated schema using the owner URL. To run that test alone:
  `AGENT_PASTE_POSTGRES_MIGRATION_TEST_URL=<owner-url> pnpm --filter @agent-paste/db exec vitest run src/postgres/upload-session-file-count-migration.test.ts`.

Migration `0032` allows zero uploaded files on a session while retaining the
nonnegative bound. Empty full publishes and no-op deltas remain invalid at the
API boundary; finalize still rejects an empty merged tree. Artifact and Revision
file-count constraints are unchanged. The migration replaces the CHECK as
`NOT VALID`, commits to release the brief exclusive lock, then validates existing
rows under a less restrictive lock. Writes enforce the new CHECK immediately.
Reruns preserve an already-correct constraint and skip completed validation; an
interruption after replacement can resume validation. Existing positive counts
already satisfy the new CHECK.
Schedule production application through the normal approved migration workflow.
