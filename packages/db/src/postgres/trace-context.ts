import type { SqlExecutor, SqlTraceIdProvider } from "../sql-types.js";

const traceIdProviders = new WeakMap<SqlExecutor, SqlTraceIdProvider>();

export function bindSqlTraceIdProvider(executor: SqlExecutor, provider: SqlTraceIdProvider) {
  traceIdProviders.set(executor, provider);
}

export function sqlTraceIdForExecutor(executor: SqlExecutor): string | undefined {
  return traceIdProviders.get(executor)?.();
}
