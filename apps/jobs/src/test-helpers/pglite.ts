import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SqlExecutor, SqlValue } from "@agent-paste/db";
import type { PGlite } from "@electric-sql/pglite";
import {
  APP_RUNTIME_ROLE,
  RUNTIME_ROLE_GUC,
  RUNTIME_ROLE_PASSWORD_GUC,
} from "../../../../packages/db/scripts/credentials.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../../../../packages/db/migrations");

export function executorForPglite(client: PGlite, role = APP_RUNTIME_ROLE): SqlExecutor {
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

function scopedExecutor(base: SqlExecutor, scope: RlsScope): SqlExecutor {
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
  return scopedExecutor(executor, { kind: "platform" });
}

export function workspaceExecutor(executor: SqlExecutor, workspaceId: string): SqlExecutor {
  return scopedExecutor(executor, { kind: "workspace", workspaceId });
}

export async function seedPublishedRevision(
  executor: SqlExecutor,
  input: {
    workspaceId: string;
    artifactId: string;
    revisionId: string;
    apiKeyId: string;
    bundleStatus?: "pending" | "ready" | "failed" | "disabled";
    r2Key: string;
  },
) {
  await platformExecutor(executor).query(
    `insert into workspaces (id, name, contact_email, created_at, updated_at)
     values ($1, 'jobs-rls', null, now(), now())
     on conflict (id) do nothing`,
    [input.workspaceId],
  );
  const tenant = workspaceExecutor(executor, input.workspaceId);
  await tenant.query(
    `insert into api_keys (id, workspace_id, public_id, name, secret_hmac, pepper_kid, scopes, created_at)
     values ($1, $2, $3, 'k', 'h', 1, '["publish","read"]'::jsonb, now())
     on conflict (id) do nothing`,
    [input.apiKeyId, input.workspaceId, `pid-${input.apiKeyId}`],
  );
  await tenant.query(
    `insert into artifacts
       (id, workspace_id, revision_id, status, title, entrypoint, file_count, size_bytes, expires_at,
        created_by_type, created_by_id, created_at, updated_at)
     values ($1, $2, $3, 'active', 't', 'index.html', 1, 100, now() + interval '1 day', 'api_key', $4, now(), now())
     on conflict (id) do nothing`,
    [input.artifactId, input.workspaceId, input.revisionId, input.apiKeyId],
  );
  await tenant.query(
    `insert into revisions
       (id, workspace_id, artifact_id, revision_number, status, entrypoint, render_mode, file_count, size_bytes,
        bundle_status, created_by_type, created_by_id, created_at, published_at)
     values ($1, $2, $3, 1, 'published', 'index.html', 'html', 1, 100, $4, 'api_key', $5, now(), now())
     on conflict (id) do nothing`,
    [input.revisionId, input.workspaceId, input.artifactId, input.bundleStatus ?? "disabled", input.apiKeyId],
  );
  await tenant.query(
    `insert into artifact_files
       (workspace_id, artifact_id, revision_id, path, size_bytes, served_content_type, r2_key, uploaded_at)
     values ($1, $2, $3, 'index.html', 100, 'text/html', $4, now())
     on conflict (artifact_id, revision_id, path) do nothing`,
    [input.workspaceId, input.artifactId, input.revisionId, input.r2Key],
  );
}
