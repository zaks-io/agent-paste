import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "../schema.js";
import type { HyperdriveBinding, SqlExecutor, SqlValue } from "../types.js";
import { withConnectRetry, withTransactionConnectRetry } from "./connect-retry.js";

export type DrizzleDb = PostgresJsDatabase<typeof schema>;

export type DrizzleConnection = {
  sql: SqlExecutor;
  drizzle: DrizzleDb;
  transaction<T>(run: (tx: DrizzleConnection) => Promise<T>): Promise<T>;
};

export const DEFAULT_POSTGRES_OPTIONS = {
  max: 5,
  prepare: false,
  idle_timeout: 20,
  connect_timeout: 10,
} as const;

const drizzleByExecutor = new WeakMap<SqlExecutor, DrizzleDb>();

export function drizzleForExecutor(executor: SqlExecutor): DrizzleDb | undefined {
  return drizzleByExecutor.get(executor);
}

export function bindDrizzleToExecutor(executor: SqlExecutor, drizzleDb: DrizzleDb) {
  drizzleByExecutor.set(executor, drizzleDb);
}

export function createHyperdriveConnection(binding: HyperdriveBinding | string): DrizzleConnection {
  const connectionString = typeof binding === "string" ? binding : binding.connectionString;
  const client = postgres(connectionString, DEFAULT_POSTGRES_OPTIONS);
  return createDrizzleConnection(client);
}

export function createDrizzleConnection(client: Sql): DrizzleConnection {
  return wrap(client, drizzle(client, { schema }), true);
}

type UnsafeClient = {
  unsafe(query: string, parameters?: readonly unknown[]): Promise<unknown>;
};

// drizzle(client, …) reads client.options.parsers; postgres-js TransactionSql does not
// expose that. Route nested transactions through drizzle.transaction() so the tx-bound
// DrizzleDb + its session.client are produced by drizzle itself.
function wrap(client: UnsafeClient, drizzleDb: DrizzleDb, retry: boolean): DrizzleConnection {
  // A single query is safe to retry on any connect-class failure; a transaction
  // only on an establishment failure (see connect-retry.ts). The tx-bound wrapper
  // (retry: false) never retries: its connection is already open.
  const identity = <T>(run: () => Promise<T>) => run();
  const queryGuard = retry ? withConnectRetry : identity;
  const txGuard = retry ? withTransactionConnectRetry : identity;
  const sql: SqlExecutor = {
    async query<Row = Record<string, unknown>>(query: string, params: readonly SqlValue[] = []) {
      const rows = (await queryGuard(() => client.unsafe(query, params as readonly unknown[]))) as unknown;
      return { rows: rows as Row[] };
    },
    async transaction<T>(run: (tx: SqlExecutor) => Promise<T>) {
      return txGuard(() =>
        drizzleDb.transaction(async (txDb) => {
          const txClient = (txDb as unknown as { session: { client: UnsafeClient } }).session.client;
          return run(wrap(txClient, txDb as unknown as DrizzleDb, false).sql);
        }),
      ) as Promise<T>;
    },
  };
  drizzleByExecutor.set(sql, drizzleDb);
  return {
    sql,
    drizzle: drizzleDb,
    // DrizzleConnection.transaction hands callers the full wrapped connection (sql + drizzle)
    // so they can run typed queries; SqlExecutor.transaction sticks to the SqlExecutor contract.
    async transaction<T>(run: (tx: DrizzleConnection) => Promise<T>) {
      return txGuard(() =>
        drizzleDb.transaction(async (txDb) => {
          const txClient = (txDb as unknown as { session: { client: UnsafeClient } }).session.client;
          return run(wrap(txClient, txDb as unknown as DrizzleDb, false));
        }),
      ) as Promise<T>;
    },
  };
}
