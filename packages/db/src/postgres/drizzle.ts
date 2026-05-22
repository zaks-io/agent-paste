import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "../schema.js";
import type { HyperdriveBinding, SqlExecutor, SqlValue } from "../types.js";

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
  return wrap(client);
}

function wrap(client: Sql): DrizzleConnection {
  const drizzleDb = drizzle(client, { schema });
  const sql: SqlExecutor = {
    async query<Row = Record<string, unknown>>(query: string, params: readonly SqlValue[] = []) {
      const rows = await client.unsafe(query, params as unknown as (string | number | boolean | null)[]);
      return { rows: rows as unknown as Row[] };
    },
    async transaction<T>(run: (tx: SqlExecutor) => Promise<T>) {
      return client.begin((tx) => {
        // Each nested wrap() also binds drizzle to the inner SqlExecutor via the
        // module-level WeakMap, so handlers that promote tx -> Drizzle still work.
        const txConn = wrap(tx as unknown as Sql);
        return run(txConn.sql);
      }) as Promise<T>;
    },
  };
  drizzleByExecutor.set(sql, drizzleDb);
  return {
    sql,
    drizzle: drizzleDb,
    // DrizzleConnection.transaction intentionally hands callers the full wrapped
    // connection (sql + drizzle) so they can run typed queries; SqlExecutor.transaction
    // sticks to the SqlExecutor contract for callers that only see raw SQL.
    async transaction<T>(run: (tx: DrizzleConnection) => Promise<T>) {
      return client.begin(async (tx) => run(wrap(tx as unknown as Sql))) as Promise<T>;
    },
  };
}
