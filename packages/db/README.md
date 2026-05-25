# db

Drizzle schema, migrations, repository adapters, and query helpers.

Responsibilities:

- Postgres table definitions.
- RLS policies in migrations.
- Migration scripts.
- Transaction helpers.
- Tenant-scoped Postgres repository helpers.
- Local in-memory repository for tests and the local MVP harness.
- API key generation and verification.

Schema target: [`docs/specs/data-model.md`](../../docs/specs/data-model.md).
