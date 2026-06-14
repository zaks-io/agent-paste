import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { repositoryError } from "../repository-error.js";
import * as schema from "../schema.js";
import type { HyperdriveBinding, SqlExecutor, SqlValue } from "../types.js";
import { withConnectRetry, withTransactionConnectRetry } from "./connect-retry.js";
import { bindDrizzleToExecutor, DEFAULT_POSTGRES_OPTIONS, type DrizzleDb } from "./drizzle.js";

type PostgresUnsafeClient = {
  unsafe<Row extends Record<string, unknown>[] = Record<string, unknown>[]>(
    query: string,
    parameters?: readonly unknown[],
  ): Promise<Row>;
};

export function createHyperdriveExecutor(binding: HyperdriveBinding | string): SqlExecutor {
  const connectionString = typeof binding === "string" ? binding : binding.connectionString;
  const sql = postgres(connectionString, DEFAULT_POSTGRES_OPTIONS);
  return createPostgresExecutor(sql);
}

// drizzle(client, …) reads client.options.parsers, which postgres-js' TransactionSql
// does not expose. Build the DrizzleDb once here and let drizzle.transaction() hand us
// the tx-bound DrizzleDb + TransactionSql, instead of re-constructing inside sql.begin.
export function createPostgresExecutor(sql: Sql): SqlExecutor {
  // Top-level executor retries cold-start connect failures; the inner tx-bound
  // executor (retry: false) must not, because its connection is already open and
  // a retry would re-run committed statements.
  return buildExecutor(sql, drizzle(sql, { schema }), true);
}

function buildExecutor(client: PostgresUnsafeClient, drizzleDb: DrizzleDb, retry: boolean): SqlExecutor {
  // A single query is safe to retry on any connect-class failure; a transaction
  // only on an establishment failure (see connect-retry.ts). The inner tx-bound
  // executor (retry: false) never retries: its connection is already open.
  const identity = <T>(run: () => Promise<T>) => run();
  const queryGuard = retry ? withConnectRetry : identity;
  const txGuard = retry ? withTransactionConnectRetry : identity;
  const executor: SqlExecutor = {
    async query<Row = Record<string, unknown>>(query: string, params: readonly SqlValue[] = []) {
      const rows = await queryGuard(() => client.unsafe(query, params as readonly unknown[]));
      return { rows: rows as unknown as Row[] };
    },
    async transaction<T>(run: (tx: SqlExecutor) => Promise<T>) {
      return txGuard(() =>
        drizzleDb.transaction(async (txDb) => {
          const txClient = (txDb as unknown as { session: { client: PostgresUnsafeClient } }).session.client;
          return run(buildExecutor(txClient, txDb as unknown as DrizzleDb, false));
        }),
      ) as Promise<T>;
    },
  };
  bindDrizzleToExecutor(executor, drizzleDb);
  return executor;
}

export function createPostgresHttpExecutor(options: {
  endpoint: string;
  token?: string;
  fetch?: typeof fetch;
}): SqlExecutor {
  const fetchImpl = options.fetch ?? fetch;
  return {
    async query<Row = Record<string, unknown>>(sql: string, params: readonly SqlValue[] = []) {
      const response = await fetchImpl(options.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        },
        body: JSON.stringify({ sql, params }),
      });
      if (!response.ok) {
        repositoryError("postgres_http_error");
      }
      const body = (await response.json()) as { rows?: Row[] };
      return { rows: body.rows ?? [] };
    },
    async transaction<T>(_run: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      repositoryError("postgres_http_executor_no_transactions");
    },
  };
}
