import type { Sql } from "postgres";
import { describe, expect, it } from "vitest";
import { createPostgresExecutor } from "./executor.js";

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
});
