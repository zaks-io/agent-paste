import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import type { SqlExecutor, SqlValue } from "../types.js";
import { rlsExecutor } from "./rls.js";

const here = dirname(fileURLToPath(import.meta.url));

function executorForPglite(client: PGlite, role?: string): SqlExecutor {
  const wrapInner = (runner: { query: PGlite["query"] }): SqlExecutor => ({
    async query<Row = Record<string, unknown>>(sql: string, params: readonly SqlValue[] = []) {
      const result = await runner.query<Record<string, unknown>>(sql, params as unknown[]);
      return { rows: result.rows as unknown as Row[] };
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

async function applyMigrations(client: PGlite) {
  const dir = resolve(here, "../../migrations");
  const files = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  for (const file of files) {
    const text = await readFile(resolve(dir, file), "utf8");
    await client.exec(text);
  }
}

async function provisionRuntimeRole(client: PGlite) {
  await client.exec(`
    create role agent_paste_runtime nosuperuser nobypassrls;
    grant select, insert, update, delete on
      workspaces, api_keys, upload_sessions, upload_session_files,
      artifacts, artifact_files, operation_events, idempotency_records
    to agent_paste_runtime;
  `);
}

const ws1Id = "11111111-1111-1111-1111-111111111111";
const ws2Id = "22222222-2222-2222-2222-222222222222";

async function platformQuery(executor: SqlExecutor, sql: string, params: SqlValue[] = []) {
  return rlsExecutor(executor, { kind: "platform" }).query(sql, params);
}

async function seedWorkspaces(executor: SqlExecutor) {
  await platformQuery(
    executor,
    `insert into workspaces (id, name, contact_email, created_at, updated_at)
     values ($1, 'ws-one', null, now(), now()), ($2, 'ws-two', null, now(), now())`,
    [ws1Id, ws2Id],
  );
}

async function insertArtifact(executor: SqlExecutor, workspaceId: string, artifactId: string, apiKeyId: string) {
  const tenant = rlsExecutor(executor, { kind: "workspace", workspaceId });
  await tenant.query(
    `insert into api_keys (id, workspace_id, public_id, name, secret_hmac, pepper_kid, scopes, created_at)
     values ($1, $2, $3, 'k', 'h', 1, '["publish","read"]'::jsonb, now())`,
    [apiKeyId, workspaceId, `pid-${apiKeyId}`],
  );
  await tenant.query(
    `insert into artifacts
       (id, workspace_id, revision_id, status, title, entrypoint, file_count, size_bytes, expires_at,
        created_by_api_key_id, created_at, updated_at)
     values ($1, $2, $3, 'active', 't', 'index.html', 1, 1, now() + interval '1 day', $4, now(), now())`,
    [artifactId, workspaceId, `rev-${artifactId}`, apiKeyId],
  );
}

describe("postgres RLS runtime enforcement", () => {
  let client: PGlite;
  let executor: SqlExecutor;

  beforeAll(async () => {
    client = new PGlite();
    await applyMigrations(client);
    await provisionRuntimeRole(client);
    executor = executorForPglite(client, "agent_paste_runtime");
    await seedWorkspaces(executor);
    await insertArtifact(executor, ws1Id, "art-ws1", "key-ws1");
    await insertArtifact(executor, ws2Id, "art-ws2", "key-ws2");
  });

  it("returns only the tenant's artifacts when scoped to a workspace", async () => {
    const ws1 = rlsExecutor(executor, { kind: "workspace", workspaceId: ws1Id });
    const rows = await ws1.query<{ id: string; workspace_id: string }>("select id, workspace_id from artifacts");
    expect(rows.rows).toEqual([{ id: "art-ws1", workspace_id: ws1Id }]);
  });

  it("cannot read another workspace's artifact even by primary key", async () => {
    const ws2 = rlsExecutor(executor, { kind: "workspace", workspaceId: ws2Id });
    const rows = await ws2.query("select id from artifacts where id = $1", ["art-ws1"]);
    expect(rows.rows).toEqual([]);
  });

  it("fails to insert a row whose workspace_id does not match the tenant scope", async () => {
    const ws2 = rlsExecutor(executor, { kind: "workspace", workspaceId: ws2Id });
    await expect(
      ws2.query(
        `insert into artifacts
           (id, workspace_id, revision_id, status, title, entrypoint, file_count, size_bytes, expires_at,
            created_by_api_key_id, created_at, updated_at)
         values ('bad', $1, 'rev-bad', 'active', 't', 'i.html', 1, 1, now() + interval '1 day', 'key-ws2', now(), now())`,
        [ws1Id],
      ),
    ).rejects.toThrow();
  });

  it("returns zero rows when no scope is set (fail-closed default)", async () => {
    const rows = await executor.query("select id from artifacts");
    expect(rows.rows).toEqual([]);
  });

  it("sees every workspace under platform scope", async () => {
    const platform = rlsExecutor(executor, { kind: "platform" });
    const rows = await platform.query<{ id: string }>("select id from artifacts order by id");
    expect(rows.rows.map((row) => row.id)).toEqual(["art-ws1", "art-ws2"]);
  });

  // The deploy-production migration runner has no journal table; it re-applies
  // every .sql file every run. Bare `create policy` failed here in 2026-05-22's
  // prod deploys. Re-applying the migrations must be a no-op.
  it("re-applies migrations idempotently", async () => {
    await expect(applyMigrations(client)).resolves.toBeUndefined();
  });
});
