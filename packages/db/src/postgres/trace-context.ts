import type { SqlExecutor, SqlTraceIdProvider } from "../sql-types.js";

const traceIdProviders = new WeakMap<SqlExecutor, SqlTraceIdProvider>();

export function bindSqlTraceIdProvider(executor: SqlExecutor, provider: SqlTraceIdProvider) {
  traceIdProviders.set(executor, provider);
}

export function sqlTraceIdForExecutor(executor: SqlExecutor): string | undefined {
  const provider = traceIdProviders.get(executor);
  if (!provider) {
    return undefined;
  }
  try {
    return provider();
  } catch {
    return undefined;
  }
}
