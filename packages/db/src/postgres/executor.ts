import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "../schema.js";
import type { HyperdriveBinding, SqlExecutor, SqlValue } from "../types.js";
import { bindDrizzleToExecutor, DEFAULT_POSTGRES_OPTIONS } from "./drizzle.js";

type PostgresUnsafeClient = {
  unsafe<Row extends Record<string, unknown>[] = Record<string, unknown>[]>(
    query: string,
    parameters?: readonly unknown[],
  ): Promise<Row>;
  begin?<T>(run: (tx: PostgresUnsafeClient) => Promise<T>): Promise<T>;
};

export function createHyperdriveExecutor(binding: HyperdriveBinding | string): SqlExecutor {
  const connectionString = typeof binding === "string" ? binding : binding.connectionString;
  const sql = postgres(connectionString, DEFAULT_POSTGRES_OPTIONS);
  return createPostgresExecutor(sql as unknown as PostgresUnsafeClient, sql);
}

export function createPostgresExecutor(sql: PostgresUnsafeClient, drizzleClient?: Sql): SqlExecutor {
  const executor: SqlExecutor = {
    async query<Row = Record<string, unknown>>(query: string, params: readonly SqlValue[] = []) {
      const rows = await sql.unsafe(query, params as unknown[]);
      return { rows: rows as Row[] };
    },
    async transaction<T>(run: (tx: SqlExecutor) => Promise<T>) {
      if (!sql.begin) {
        throw new Error("postgres_executor_missing_begin");
      }
      return sql.begin((tx) => run(createPostgresExecutor(tx, tx as unknown as Sql)));
    },
  };
  if (drizzleClient) {
    bindDrizzleToExecutor(executor, drizzle(drizzleClient, { schema }));
  }
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
        throw new Error(`postgres_http_error:${response.status}`);
      }
      const body = (await response.json()) as { rows?: Row[] };
      return { rows: body.rows ?? [] };
    },
    async transaction<T>(_run: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      throw new Error("postgres_http_executor_no_transactions");
    },
  };
}
