# Database Migrations and Preview Environments

Database schema and migrations will live in `packages/db` and be run by GitHub Actions as part of environment promotion, not by Workers at request or startup time. The deployment system must support preview environments so pull requests can exercise Workers, R2 bindings, and Postgres-backed metadata before production deployment.

## Consequences

- Workers import database code from `packages/db` but do not own schema migration.
- GitHub Actions is responsible for applying migrations to the target environment before deploying dependent Workers.
- Production migrations should follow an expand/contract pattern so destructive schema changes are delayed until code no longer depends on the old shape.
- Preview environments use a Postgres schema per pull request and R2 isolation by preview bucket or prefix so tests do not contaminate production state.
- Preview Workers use preview-specific names or routes and Auth0 uses development credentials rather than production credentials.
- Pull request close workflows should destroy preview resources, and a scheduled janitor workflow should remove stale preview schemas, R2 namespaces, and Worker resources when cleanup fails.
