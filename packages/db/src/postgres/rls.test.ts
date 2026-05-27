import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import {
  APP_RUNTIME_ROLE,
  RUNTIME_ROLE_GUC,
  RUNTIME_ROLE_PASSWORD_GUC,
} from "../../scripts/credentials.mjs";
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

async function applyMigrationFile(client: PGlite, file: string) {
  const dir = resolve(here, "../../migrations");
  if (file === "0010_db_roles.sql") {
    await client.exec(`select set_config('${RUNTIME_ROLE_GUC}', '${APP_RUNTIME_ROLE}', false)`);
    await client.exec(`select set_config('${RUNTIME_ROLE_PASSWORD_GUC}', 'test-runtime-password', false)`);
    try {
      const text = await readFile(resolve(dir, file), "utf8");
      await client.exec(text);
    } finally {
      await client.exec(`select set_config('${RUNTIME_ROLE_GUC}', '', false)`);
      await client.exec(`select set_config('${RUNTIME_ROLE_PASSWORD_GUC}', '', false)`);
    }
    return;
  }
  const text = await readFile(resolve(dir, file), "utf8");
  await client.exec(text);
}

async function applyMigrations(client: PGlite) {
  const dir = resolve(here, "../../migrations");
  const files = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  for (const file of files) {
    if (file === "0010_db_roles.sql") {
      await client.exec(`select set_config('${RUNTIME_ROLE_GUC}', '${APP_RUNTIME_ROLE}', false)`);
      await client.exec(`select set_config('${RUNTIME_ROLE_PASSWORD_GUC}', 'test-runtime-password', false)`);
      try {
        const text = await readFile(resolve(dir, file), "utf8");
        await client.exec(text);
      } finally {
        await client.exec(`select set_config('${RUNTIME_ROLE_GUC}', '', false)`);
        await client.exec(`select set_config('${RUNTIME_ROLE_PASSWORD_GUC}', '', false)`);
      }
      continue;
    }
    const text = await readFile(resolve(dir, file), "utf8");
    await client.exec(text);
  }
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

async function insertWorkspaceMember(
  executor: SqlExecutor,
  workspaceId: string,
  memberId: string,
  workosUserId: string,
) {
  const tenant = rlsExecutor(executor, { kind: "workspace", workspaceId });
  await tenant.query(
    `insert into workspace_members
       (id, workspace_id, workos_user_id, email, created_at, last_seen_at)
     values ($1, $2, $3, $4, now(), now())`,
    [memberId, workspaceId, workosUserId, `${memberId}@example.com`],
  );
}

describe("postgres RLS runtime enforcement", () => {
  let client: PGlite;
  let executor: SqlExecutor;

  beforeAll(async () => {
    client = new PGlite();
    await applyMigrations(client);
    executor = executorForPglite(client, APP_RUNTIME_ROLE);
    await seedWorkspaces(executor);
    await insertWorkspaceMember(executor, ws1Id, "mem-ws1", "user-ws1");
    await insertWorkspaceMember(executor, ws2Id, "mem-ws2", "user-ws2");
    await insertArtifact(executor, ws1Id, "art-ws1", "key-ws1");
    await insertArtifact(executor, ws2Id, "art-ws2", "key-ws2");
  }, 30_000);

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

  it("returns only the tenant's workspace members when scoped to a workspace", async () => {
    const ws1 = rlsExecutor(executor, { kind: "workspace", workspaceId: ws1Id });
    const rows = await ws1.query<{ id: string; workos_user_id: string }>(
      "select id, workos_user_id from workspace_members order by id",
    );
    expect(rows.rows).toEqual([{ id: "mem-ws1", workos_user_id: "user-ws1" }]);
  });

  it("enforces a globally unique WorkOS user id", async () => {
    try {
      await platformQuery(
        executor,
        `insert into workspace_members
           (id, workspace_id, workos_user_id, email, created_at, last_seen_at)
         values ('mem-dupe', $1, 'user-ws1', 'dupe@example.com', now(), now())`,
        [ws2Id],
      );
      throw new Error("expected duplicate workos_user_id to fail");
    } catch (error) {
      expect(error).toMatchObject({ code: "23505" });
    }
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

  it("accepts member actor operation events and idempotency records", async () => {
    const ws1 = rlsExecutor(executor, { kind: "workspace", workspaceId: ws1Id });
    await ws1.query(
      `insert into operation_events
         (id, workspace_id, actor_type, actor_id, action, target_type, target_id, details, occurred_at)
       values ('evt-member-actor', $1, 'member', 'mem-ws1', 'api_key.created', 'api_key', 'key-member', '{}'::jsonb, now())`,
      [ws1Id],
    );
    await ws1.query(
      `insert into idempotency_records
         (workspace_id, actor_type, actor_id, operation, idempotency_key, status, result_json, created_at, completed_at)
       values ($1, 'member', 'mem-ws1', 'web.api_key.create', 'idem-member', 'completed', '{}'::jsonb, now(), now())`,
      [ws1Id],
    );

    const events = await ws1.query<{ actor_type: string; actor_id: string }>(
      "select actor_type, actor_id from operation_events where id = 'evt-member-actor'",
    );
    const records = await ws1.query<{ actor_type: string; actor_id: string }>(
      "select actor_type, actor_id from idempotency_records where idempotency_key = 'idem-member'",
    );
    expect(events.rows).toEqual([{ actor_type: "member", actor_id: "mem-ws1" }]);
    expect(records.rows).toEqual([{ actor_type: "member", actor_id: "mem-ws1" }]);
  });

  it("rejects invalid actor types in operation events and idempotency records", async () => {
    const ws1 = rlsExecutor(executor, { kind: "workspace", workspaceId: ws1Id });
    await expect(
      ws1.query(
        `insert into operation_events
           (id, workspace_id, actor_type, actor_id, action, target_type, target_id, details, occurred_at)
         values ('evt-invalid-actor', $1, 'invalid_actor', 'mem-ws1', 'api_key.created', 'api_key', 'key-invalid', '{}'::jsonb, now())`,
        [ws1Id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      ws1.query(
        `insert into idempotency_records
           (workspace_id, actor_type, actor_id, operation, idempotency_key, status, result_json, created_at, completed_at)
         values ($1, 'invalid_actor', 'mem-ws1', 'web.api_key.create', 'idem-invalid-actor', 'completed', '{}'::jsonb, now(), now())`,
        [ws1Id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  // The deploy-production migration runner has no journal table; it re-applies
  // every .sql file every run. Bare `create policy` failed here in 2026-05-22's
  // prod deploys. Re-applying the migrations must be a no-op.
  it("scopes access_links to the tenant workspace", async () => {
    const platform = rlsExecutor(executor, { kind: "platform" });
    await platform.query(
      `insert into access_links
         (id, workspace_id, artifact_id, revision_id, public_id, type, scopes_bitmask,
          created_by_type, created_by_id, created_at)
       values ('al-ws1', $1, 'art-ws1', null, '0123456789ABCDEF', 'share', 1, 'api_key', 'key-ws1', now())`,
      [ws1Id],
    );
    await platform.query(
      `insert into access_links
         (id, workspace_id, artifact_id, revision_id, public_id, type, scopes_bitmask,
          created_by_type, created_by_id, created_at)
       values ('al-ws2', $1, 'art-ws2', null, 'FEDCBA9876543210', 'share', 1, 'api_key', 'key-ws2', now())`,
      [ws2Id],
    );

    const ws1 = rlsExecutor(executor, { kind: "workspace", workspaceId: ws1Id });
    const rows = await ws1.query<{ id: string }>("select id from access_links order by id");
    expect(rows.rows).toEqual([{ id: "al-ws1" }]);
  });

  it("re-applies migrations idempotently", async () => {
    await expect(applyMigrations(client)).resolves.toBeUndefined();
  });

  it("re-applies 0009 revisions backfill when an artifact has a null revision pointer", async () => {
    await platformQuery(
      executor,
      `insert into artifacts
         (id, workspace_id, revision_id, status, title, entrypoint, file_count, size_bytes, expires_at,
          created_by_api_key_id, created_at, updated_at)
       values ('art-null-rev', $1, null, 'active', 'draft-only', 'index.html', 1, 1, now() + interval '1 day', 'key-ws1', now(), now())`,
      [ws1Id],
    );

    await expect(applyMigrationFile(client, "0009_revisions.sql")).resolves.toBeUndefined();

    const revisions = await platformQuery(executor, "select id from revisions where id is null");
    expect(revisions.rows).toEqual([]);
    const artifact = await platformQuery(executor, "select revision_id from artifacts where id = 'art-null-rev'");
    expect(artifact.rows).toEqual([{ revision_id: null }]);
  });
});
