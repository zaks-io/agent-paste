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
