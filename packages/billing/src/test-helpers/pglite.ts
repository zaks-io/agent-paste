import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SqlExecutor, SqlValue } from "@agent-paste/commands";
import type { PGlite } from "@electric-sql/pglite";
import { APP_RUNTIME_ROLE, RUNTIME_ROLE_GUC, RUNTIME_ROLE_PASSWORD_GUC } from "../../../db/scripts/credentials.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../../../db/migrations");

export function executorForPglite(client: PGlite): SqlExecutor {
  const wrapInner = (runner: { query: PGlite["query"] }): SqlExecutor => ({
    async query<Row = Record<string, unknown>>(sql: string, params: readonly SqlValue[] = []) {
      const result = await runner.query<Record<string, unknown>>(sql, params as unknown[]);
      return { rows: result.rows as Row[] };
    },
    async transaction<T>(run: (tx: SqlExecutor) => Promise<T>) {
      return client.transaction(async (tx) => run(wrapInner(tx))) as Promise<T>;
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

type RlsScope = { kind: "workspace"; workspaceId: string } | { kind: "platform" };

function rlsExecutor(base: SqlExecutor, scope: RlsScope): SqlExecutor {
  return {
    async query(sql, params) {
      return base.transaction(async (tx) => {
        await applyScope(tx, scope);
        return tx.query(sql, params ?? []);
      });
    },
    async transaction(run) {
      return base.transaction(async (tx) => {
        await applyScope(tx, scope);
        return run(tx);
      });
    },
  };
}

async function applyScope(tx: SqlExecutor, scope: RlsScope) {
  if (scope.kind === "workspace") {
    await tx.query("select set_config('app.workspace_id', $1, true)", [scope.workspaceId]);
    await tx.query("select set_config('app.platform', '', true)");
    return;
  }
  await tx.query("select set_config('app.platform', 'on', true)");
  await tx.query("select set_config('app.workspace_id', '', true)");
}

export function platformExecutor(executor: SqlExecutor): SqlExecutor {
  return rlsExecutor(executor, { kind: "platform" });
}

export function workspaceExecutor(executor: SqlExecutor, workspaceId: string): SqlExecutor {
  return rlsExecutor(executor, { kind: "workspace", workspaceId });
}
