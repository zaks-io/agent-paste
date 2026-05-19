# Drizzle for Postgres Schema and Migrations

`packages/db` will use Drizzle for Postgres schema definitions, query helpers, and migrations. Drizzle keeps database access TypeScript-first while staying close to SQL, which fits Workers using Postgres through Hyperdrive.

## Consequences

- Database schema and migrations live in `packages/db`.
- GitHub Actions runs Drizzle migrations for preview and production environments.
- Application code should use shared database helpers rather than each app creating its own ad hoc SQL layer.
- Transaction helpers should support audit-wrapped writes.
