import { dispatchLocalMvpSqlQuery } from "./local-mvp-sql-executor/dispatch.js";
import type { IdempotencyRecord } from "./local-mvp-sql-executor/types.js";
import type { LocalState } from "./repository/local-state.js";
import type { SqlExecutor, SqlValue } from "./types.js";

/**
 * Minimal SQL executor for the local MVP harness so jobs queue handlers can share the
 * in-memory repository with API/upload workers.
 */
export function createLocalMvpSqlExecutor(state: LocalState): SqlExecutor {
  const idempotencyRecords = new Map<string, IdempotencyRecord>();
  const context = { state, idempotencyRecords };

  const query = async <Row = Record<string, unknown>>(sql: string, params: readonly SqlValue[] = []) =>
    dispatchLocalMvpSqlQuery<Row>(sql, params, context);

  const executor: SqlExecutor = {
    query: query as SqlExecutor["query"],
    transaction: async (run) => run(executor),
  };
  return executor;
}
