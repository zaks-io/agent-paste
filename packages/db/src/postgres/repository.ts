import { RepositoryCore } from "../repository/core.js";
import { PostgresUnitOfWork } from "../repository/postgres-unit-of-work.js";
import type { RepositoryOptions, SqlExecutor, SqlValue } from "../types.js";
import type { DrizzleConnection } from "./drizzle.js";

// Postgres-backed Repository. All domain logic lives in RepositoryCore; this subclass
// only wires the RLS- and idempotency-aware unit of work built over the executor.
export class PostgresRepository extends RepositoryCore {
  constructor(connection: SqlExecutor | DrizzleConnection, options: RepositoryOptions) {
    super(new PostgresUnitOfWork(connection), options);
  }
}

// Re-export type for legacy SqlValue users
export type { SqlValue };
