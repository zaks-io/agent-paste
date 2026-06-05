import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { APP_RUNTIME_ROLE, RUNTIME_ROLE_GUC, RUNTIME_ROLE_PASSWORD_GUC } from "../../scripts/credentials.mjs";
import {
  bindDrizzleToExecutor,
  type DrizzleConnection,
  type DrizzleDb,
  drizzleForExecutor,
} from "../postgres/drizzle.js";
import { rlsExecutor } from "../postgres/rls.js";
import * as schema from "../schema.js";
import type { SqlExecutor, SqlValue } from "../types.js";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../../migrations");

export function executorForPglite(client: PGlite, role?: string): SqlExecutor {
  const wrapInner = (runner: { query: PGlite["query"] }): SqlExecutor => ({
    async query<Row = Record<string, unknown>>(sql: string, params: readonly SqlValue[] = []) {
      const result = await runner.query<Record<string, unknown>>(sql, params as unknown[]);
      return { rows: result.rows as Row[] };
    },
    async transaction<T>(run: (tx: SqlExecutor) => Promise<T>) {
      return client.transaction(async (tx) => {
        if (role) {
          await tx.query(`set local role ${role}`);
        }
        return run(wrapInner(tx));
      }) as Promise<T>;
    },
  });
  const outer: SqlExecutor = {
    async query<Row = Record<string, unknown>>(sql: string, params: readonly SqlValue[] = []) {
      return outer.transaction(async (tx) => tx.query<Row>(sql, params));
    },
    async transaction<T>(run: (tx: SqlExecutor) => Promise<T>) {
      return wrapInner(client).transaction(run);
    },
  };
  return outer;
}

export function pgliteConnection(client: PGlite): DrizzleConnection {
  const drizzleDb = drizzle(client, { schema }) as unknown as DrizzleDb;

  function wrapRunner(runner: { query: PGlite["query"] }, db: DrizzleDb): SqlExecutor {
    const executor: SqlExecutor = {
      async query<Row = Record<string, unknown>>(sql: string, params: readonly SqlValue[] = []) {
        const result = await runner.query<Record<string, unknown>>(sql, params as unknown[]);
        return { rows: result.rows as Row[] };
      },
      async transaction<T>(run: (tx: SqlExecutor) => Promise<T>) {
        return client.transaction(async (tx) => {
          const txDb = drizzle(tx, { schema }) as unknown as DrizzleDb;
          const txExecutor = wrapRunner(tx, txDb);
          return run(txExecutor);
        }) as Promise<T>;
      },
    };
    bindDrizzleToExecutor(executor, db);
    return executor;
  }

  const sql = wrapRunner(client, drizzleDb);
  return {
    sql,
    drizzle: drizzleDb,
    async transaction<T>(run: (tx: DrizzleConnection) => Promise<T>) {
      return sql.transaction(async (tx) => {
        const txDrizzle = drizzleForExecutor(tx);
        if (!txDrizzle) {
          throw new Error("missing drizzle binding for transaction");
        }
        return run({ sql: tx, drizzle: txDrizzle, transaction: this.transaction });
      });
    },
  };
}

async function applyDbRolesMigration(client: PGlite) {
  await client.exec(`select set_config('${RUNTIME_ROLE_GUC}', '${APP_RUNTIME_ROLE}', false)`);
  await client.exec(`select set_config('${RUNTIME_ROLE_PASSWORD_GUC}', 'test-runtime-password', false)`);
  try {
    const text = await readFile(resolve(migrationsDir, "0010_db_roles.sql"), "utf8");
    await client.exec(text);
  } finally {
    await client.exec(`select set_config('${RUNTIME_ROLE_GUC}', '', false)`);
    await client.exec(`select set_config('${RUNTIME_ROLE_PASSWORD_GUC}', '', false)`);
  }
}

export async function applyMigrations(client: PGlite) {
  const files = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();
  for (const file of files) {
    if (file === "0010_db_roles.sql") {
      await applyDbRolesMigration(client);
      continue;
    }
    const text = await readFile(resolve(migrationsDir, file), "utf8");
    await client.exec(text);
  }
}

export function platformExecutor(executor: SqlExecutor): SqlExecutor {
  return rlsExecutor(executor, { kind: "platform" });
}

export function workspaceExecutor(executor: SqlExecutor, workspaceId: string): SqlExecutor {
  return rlsExecutor(executor, { kind: "workspace", workspaceId });
}
