import type { SqlExecutor } from "@agent-paste/db";
import { vi } from "vitest";

type QueryHandler = (sql: string, params?: readonly unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

export function createTransactionalSqlExecutor(
  handler: QueryHandler,
): SqlExecutor & { query: ReturnType<typeof vi.fn> } {
  const query = vi.fn(handler) as SqlExecutor["query"] & ReturnType<typeof vi.fn>;
  const transaction = vi.fn(async <T>(run: (tx: SqlExecutor) => Promise<T>) =>
    run({
      query,
      transaction,
    }),
  ) as SqlExecutor["transaction"];
  return { query, transaction };
}
