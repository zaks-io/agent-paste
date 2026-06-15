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
