import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { APP_RUNTIME_ROLE, RUNTIME_ROLE_GUC, RUNTIME_ROLE_PASSWORD_GUC } from "../scripts/credentials.mjs";
import { LocalRepository } from "./local-repository.js";
import { rlsExecutor } from "./postgres/rls.js";
import type { SqlExecutor, SqlValue } from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));
const wsId = "11111111-1111-1111-1111-111111111111";

function executorForPglite(client: PGlite): SqlExecutor {
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
  const dir = resolve(here, "../migrations");
  await client.exec(`select set_config('${RUNTIME_ROLE_GUC}', '${APP_RUNTIME_ROLE}', false)`);
  await client.exec(`select set_config('${RUNTIME_ROLE_PASSWORD_GUC}', 'test-runtime-password', false)`);
  try {
    const text = await readFile(resolve(dir, "0010_db_roles.sql"), "utf8");
    await client.exec(text);
  } finally {
    await client.exec(`select set_config('${RUNTIME_ROLE_GUC}', '', false)`);
    await client.exec(`select set_config('${RUNTIME_ROLE_PASSWORD_GUC}', '', false)`);
  }
}

async function applyMigrations(client: PGlite) {
  const dir = resolve(here, "../migrations");
  const files = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  for (const file of files) {
    if (file === "0010_db_roles.sql") {
      await applyDbRolesMigration(client);
      continue;
    }
    const text = await readFile(resolve(dir, file), "utf8");
    await client.exec(text);
  }
}

async function platformQuery(executor: SqlExecutor, sql: string, params: SqlValue[] = []) {
  return rlsExecutor(executor, { kind: "platform" }).query(sql, params);
}

async function seedMember(executor: SqlExecutor, memberId: string) {
  await platformQuery(
    executor,
    `insert into workspaces (id, name, contact_email, created_at, updated_at)
     values ($1, 'mcp', 'mcp@example.com', now(), now())
     on conflict (id) do nothing`,
    [wsId],
  );
  const tenant = rlsExecutor(executor, { kind: "workspace", workspaceId: wsId });
  await tenant.query(
    `insert into workspace_members
       (id, workspace_id, workos_user_id, email, created_at, last_seen_at)
     values ($1, $2, $3, $4, now(), now())
     on conflict (id) do nothing`,
    [memberId, wsId, "user_mcp_member", "mcp@example.com"],
  );
}

describe("member MCP publish persistence", () => {
  it("stores polymorphic creator columns on Postgres without api_keys FK failures", async () => {
    const client = new PGlite();
    await applyMigrations(client);
    const executor = executorForPglite(client);
    const memberId = "mem_mcp_publish";
    await seedMember(executor, memberId);
    const tenant = rlsExecutor(executor, { kind: "workspace", workspaceId: wsId });

    await tenant.query(
      `insert into upload_sessions
         (id, workspace_id, artifact_id, revision_id, status, title, entrypoint,
          artifact_expires_at, file_count, size_bytes, created_by_type, created_by_id,
          expires_at, created_at)
       values
         ('upl_member', $1, 'art_member', 'rev_member', 'pending', 'note', 'index.md',
          now() + interval '7 days', 1, 5, 'member', $2,
          now() + interval '1 day', now())`,
      [wsId, memberId],
    );

    await tenant.query(
      `insert into artifacts
         (id, workspace_id, revision_id, status, title, entrypoint, file_count, size_bytes,
          expires_at, created_by_type, created_by_id, created_at, updated_at)
       values
         ('art_member', $1, null, 'active', 'note', 'index.md', 1, 5,
          now() + interval '7 days', 'member', $2, now(), now())`,
      [wsId, memberId],
    );

    await tenant.query(
      `insert into revisions
         (id, workspace_id, artifact_id, revision_number, status, entrypoint, render_mode,
          file_count, size_bytes, bundle_status, created_by_type, created_by_id, created_at)
       values
         ('rev_member', $1, 'art_member', null, 'draft', 'index.md', 'markdown',
          1, 5, 'disabled', 'member', $2, now())`,
      [wsId, memberId],
    );

    const session = await tenant.query<{ created_by_type: string; created_by_id: string }>(
      "select created_by_type, created_by_id from upload_sessions where id = 'upl_member'",
    );
    expect(session.rows[0]).toEqual({ created_by_type: "member", created_by_id: memberId });
  });

  it("writes member actor metadata through the repository upload lifecycle", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    await repo.resolveWebMember({
      workosUserId: "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ",
      email: "mcp-member@example.com",
      idempotencyKey: "workos-jti:lifecycle-member",
      now: "2026-01-01T00:00:00.000Z",
    });
    const member = await repo.getWebMemberByWorkOsUserId({ workosUserId: "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ" });
    if (!member || member.type !== "member") {
      throw new Error("expected member actor");
    }

    const upload = await repo.createUploadSession({
      actor: member,
      idempotencyKey: "idem-member-upload",
      request: {
        title: "MCP note",
        entrypoint: "index.md",
        files: [{ path: "index.md", size_bytes: 5 }],
      },
      now: "2026-01-01T00:00:01.000Z",
    });
    const session = repo.uploadSessions.get(upload.upload_session_id);
    expect(session).toMatchObject({
      created_by_type: "member",
      created_by_id: member.id,
    });

    const events = [...repo.operationEvents.values()].filter((event) => event.workspace_id === member.workspace_id);
    expect(events.some((event) => event.action === "upload_session.created" && event.actor_type === "member")).toBe(
      true,
    );

    const file = upload.files[0];
    if (!file) {
      throw new Error("expected upload file");
    }
    const finalized = await repo.finalizeUploadSession({
      actor: member,
      idempotencyKey: "idem-member-finalize",
      sessionId: upload.upload_session_id,
      observedFiles: [{ path: "index.md", objectKey: file.object_key, sizeBytes: 5 }],
      now: "2026-01-01T00:00:02.000Z",
    });
    const revision = repo.revisions.get(finalized.revision_id);
    expect(revision).toMatchObject({
      created_by_type: "member",
      created_by_id: member.id,
    });
  });
});
