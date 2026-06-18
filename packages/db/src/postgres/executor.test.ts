import { eq } from "drizzle-orm";
import type { Sql } from "postgres";
import { describe, expect, it, vi } from "vitest";
import * as schema from "../schema.js";
import type { SqlQueryInstrumentation } from "../types.js";
import { drizzleForExecutor } from "./drizzle.js";
import { createPostgresExecutor } from "./executor.js";
import { withSqlQuerySource } from "./query-source.js";

// Regression for prod Bug A (2026-05-22): drizzle-orm/postgres-js' construct() reads
// client.options.parsers, but postgres-js' TransactionSql does not expose .options.
// The previous executor called drizzle(tx) inside sql.begin and threw
// "Cannot read properties of undefined (reading 'parsers')" on every transaction.
describe("createPostgresExecutor", () => {
  it("runs nested transactions without re-constructing drizzle on the TransactionSql", async () => {
    const txQueries: Array<{ sql: string; params: unknown[] }> = [];
    const rootQueries: Array<{ sql: string; params: unknown[] }> = [];

    const txSql = {
      async unsafe(sql: string, params: unknown[] = []) {
        txQueries.push({ sql, params });
        return [];
      },
    };

    const sql = {
      options: { parsers: {}, serializers: {} },
      async unsafe(sql: string, params: unknown[] = []) {
        rootQueries.push({ sql, params });
        return [];
      },
      async begin<T>(cb: (tx: typeof txSql) => Promise<T>): Promise<T> {
        return cb(txSql);
      },
    };

    const executor = createPostgresExecutor(sql as unknown as Sql);
    const result = await executor.transaction(async (tx) => {
      await tx.query("insert into idempotency_records values ($1)", ["k"]);
      await tx.query("insert into workspaces values ($1)", ["ws"]);
      return "ok";
    });

    expect(result).toBe("ok");
    expect(txQueries.map((q) => q.sql)).toEqual([
      "insert into idempotency_records values ($1)",
      "insert into workspaces values ($1)",
    ]);
    expect(rootQueries).toEqual([]);
  });

  // The cold-start connect retry lives on the top-level executor query path; a
  // transient connect failure on the first call must not surface to the caller.
  it("transparently retries a cold-start connect failure on the first query", async () => {
    let attempts = 0;
    const sql = {
      options: { parsers: {}, serializers: {} },
      async unsafe() {
        attempts += 1;
        if (attempts === 1) {
          throw Object.assign(new Error("Timed out while creating a new server connection."), {
            code: "CONNECT_TIMEOUT",
          });
        }
        return [{ ok: true }];
      },
    };

    const executor = createPostgresExecutor(sql as unknown as Sql);
    const { rows } = await executor.query("select 1");

    expect(rows).toEqual([{ ok: true }]);
    expect(attempts).toBe(2);
  });

  it("passes top-level and transaction queries through instrumentation", async () => {
    const txSql = {
      async unsafe(sql: string, params: unknown[] = []) {
        return [{ sql, params, tx: true }];
      },
    };
    const sql = {
      options: { parsers: {}, serializers: {} },
      async unsafe(sql: string, params: unknown[] = []) {
        return [{ sql, params, tx: false }];
      },
      async begin<T>(cb: (tx: typeof txSql) => Promise<T>): Promise<T> {
        return cb(txSql);
      },
    };
    const instrumentQuery = vi.fn(
      async (_input: Parameters<SqlQueryInstrumentation>[0], run: Parameters<SqlQueryInstrumentation>[1]) => run(),
    );
    const executor = createPostgresExecutor(sql as unknown as Sql, { instrumentQuery }, { databaseName: "test_db" });

    await withSqlQuerySource(
      {
        filepath: "packages/db/src/queries/artifacts.ts",
        functionName: "artifactQueries.findById",
        namespace: "packages.db.src.queries.artifacts",
      },
      async () => executor.query("select * from artifacts where id = $1", ["art_1"]),
    );
    await withSqlQuerySource(
      {
        filepath: "packages/db/src/queries/workspaces.ts",
        functionName: "workspaceQueries.findById",
        namespace: "packages.db.src.queries.workspaces",
      },
      async () => executor.transaction((tx) => tx.query("select * from workspaces where id = $1", ["ws_1"])),
    );

    expect(instrumentQuery).toHaveBeenCalledTimes(2);
    expect(instrumentQuery.mock.calls.map(([input]) => input)).toEqual([
      {
        sql: "select * from artifacts where id = $1",
        params: ["art_1"],
        connection: { databaseName: "test_db" },
        source: {
          filepath: "packages/db/src/queries/artifacts.ts",
          functionName: "artifactQueries.findById",
          namespace: "packages.db.src.queries.artifacts",
        },
      },
      {
        sql: "select * from workspaces where id = $1",
        params: ["ws_1"],
        connection: { databaseName: "test_db" },
        source: {
          filepath: "packages/db/src/queries/workspaces.ts",
          functionName: "workspaceQueries.findById",
          namespace: "packages.db.src.queries.workspaces",
        },
      },
    ]);
  });

  it("passes Drizzle queries through instrumentation", async () => {
    const txSql = {
      unsafe(sql: string, params: unknown[] = []) {
        return pendingRows([{ sql, params, tx: true }], [["ws_1"]]);
      },
    };
    const sql = {
      options: { parsers: {}, serializers: {} },
      unsafe(sql: string, params: unknown[] = []) {
        return pendingRows([{ sql, params, tx: false }], [["art_1"]]);
      },
      async begin<T>(cb: (tx: typeof txSql) => Promise<T>): Promise<T> {
        return cb(txSql);
      },
    };
    const instrumentQuery = vi.fn(
      async (_input: Parameters<SqlQueryInstrumentation>[0], run: Parameters<SqlQueryInstrumentation>[1]) => run(),
    );
    const executor = createPostgresExecutor(sql as unknown as Sql, { instrumentQuery }, { databaseName: "test_db" });
    const db = drizzleForExecutor(executor);
    if (!db) {
      throw new Error("expected root Drizzle binding");
    }

    await db
      .select({ id: schema.artifacts.id })
      .from(schema.artifacts)
      .where(eq(schema.artifacts.id, "art_1"))
      .limit(1);
    await executor.transaction(async (tx) => {
      const txDb = drizzleForExecutor(tx);
      if (!txDb) {
        throw new Error("expected transaction Drizzle binding");
      }
      await txDb
        .select({ id: schema.workspaces.id })
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, "ws_1"))
        .limit(1);
    });

    expect(instrumentQuery).toHaveBeenCalledTimes(2);
    expect(instrumentQuery.mock.calls.map(([input]) => input)).toEqual([
      {
        sql: expect.stringContaining('from "artifacts"'),
        params: ["art_1", 1],
        connection: { databaseName: "test_db" },
      },
      {
        sql: expect.stringContaining('from "workspaces"'),
        params: ["ws_1", 1],
        connection: { databaseName: "test_db" },
      },
    ]);
  });

  // A transaction must not retry a mid-flight connection drop: the drop can fire
  // after COMMIT, so re-running the callback could double-apply writes.
  it("does not retry a transaction when the connection drops mid-flight", async () => {
    let begins = 0;
    const sql = {
      options: { parsers: {}, serializers: {} },
      async unsafe() {
        return [];
      },
      async begin() {
        begins += 1;
        throw Object.assign(new Error("write CONNECTION_CLOSED 10.0.0.1:5432"), { code: "CONNECTION_CLOSED" });
      },
    };

    const executor = createPostgresExecutor(sql as unknown as Sql);
    await expect(executor.transaction(async () => "never")).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
    expect(begins).toBe(1);
  });
});

function pendingRows(rows: unknown[], valuesRows: unknown[][] = rows.map(Object.values)) {
  const query = Promise.resolve(rows) as Promise<unknown[]> & {
    values(): Promise<unknown[][]>;
    raw(): Promise<unknown[][]>;
    simple(): typeof query;
  };
  query.values = async () => valuesRows;
  query.raw = async () => valuesRows;
  query.simple = () => query;
  return query;
}
