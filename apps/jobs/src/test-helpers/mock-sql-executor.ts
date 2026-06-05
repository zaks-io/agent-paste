import type { SqlExecutor, SqlValue } from "@agent-paste/db";

type QueryFn = (sql: string, params?: readonly SqlValue[]) => Promise<{ rows: unknown[] }>;

function isTransactionQuery(sql: string): boolean {
  return (
    sql.includes("set_config(") ||
    sql.includes("idempotency_records") ||
    sql.includes("operation_events") ||
    sql.includes("safety_warnings") ||
    sql.includes("platform_lockdowns") ||
    sql.includes("update revisions")
  );
}

export function createMockSqlExecutor(queryFn: QueryFn, txQueryFn: QueryFn = queryFn): SqlExecutor {
  const combinedQuery: QueryFn = async (sql, params) => {
    if (isTransactionQuery(sql)) {
      return txQueryFn(sql, params);
    }
    return queryFn(sql, params);
  };
  const tx: SqlExecutor = {
    query: combinedQuery,
    transaction: async (run) => run(tx),
  };
  return {
    query: async (sql, params) => tx.transaction(async (inner) => inner.query(sql, params)),
    transaction: async (run) => run(tx),
  };
}
