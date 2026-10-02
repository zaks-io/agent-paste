import { CreateUploadSessionRequest } from "@agent-paste/contracts";
import { PGlite } from "@electric-sql/pglite";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDrizzleConnection } from "../postgres/drizzle.js";
import { PostgresRepository } from "../postgres/repository.js";
import { applyMigrations, pgliteConnection, workspaceExecutor } from "../test-helpers/pglite.js";
import type { ApiActor, SqlExecutor } from "../types.js";

// The Postgres smoke runner supplies an already-migrated disposable database,
// using app_role. Ordinary unit runs exercise the same assertions with PGlite.
const databaseUrl = process.env.AGENT_PASTE_POSTGRES_TEST_URL;
const now = "2026-01-01T00:00:00.000Z";

describe(`delete-only upload lifecycle (${databaseUrl ? "PostgreSQL" : "PGlite"})`, () => {
  let repo: PostgresRepository;
  let actor: ApiActor;
  let sql: SqlExecutor;
  let close: () => Promise<void>;
  let base: { artifact_id: string; revision_id: string };

  beforeAll(async () => {
    const client = databaseUrl ? postgres(databaseUrl, { max: 1, prepare: false }) : new PGlite();
    close = async () => {
      if (client instanceof PGlite) await client.close();
      else await client.end({ timeout: 5 });
    };
    if (client instanceof PGlite) await applyMigrations(client);
    const connection = client instanceof PGlite ? pgliteConnection(client) : createDrizzleConnection(client);
    repo = new PostgresRepository(connection, { apiKeyPepper: "test-pepper" });
    const admin = { type: "admin" as const, id: "operator" };
    const suffix = crypto.randomUUID();
    const workspace = await repo.createWorkspace({
      actor: admin,
      idempotencyKey: `delete-only-workspace-${suffix}`,
      email: `delete-only-${suffix}@example.com`,
    });
    const key = await repo.createApiKey({
      actor: admin,
      idempotencyKey: `delete-only-key-${suffix}`,
      workspaceId: workspace.id,
      name: "regression",
    });
    const verified = await repo.verifyApiKey(key.secret);
    if (!verified) throw new Error("expected API actor");
    actor = verified;
    sql = workspaceExecutor(connection.sql, actor.workspace_id);
    if (databaseUrl) {
      expect((await sql.query<{ role: string }>("select current_user as role")).rows[0]?.role).toBe("app_role");
    }
  }, 120_000);

  beforeEach(async () => {
    const suffix = crypto.randomUUID();
    const session = await repo.createUploadSession({
      actor,
      idempotencyKey: `delete-only-base-${suffix}`,
      request: {
        entrypoint: "index.html",
        files: [
          { path: "index.html", size_bytes: 12, sha256: "a".repeat(64) },
          { path: "b.css", size_bytes: 20, sha256: "b".repeat(64) },
          { path: "c.js", size_bytes: 30, sha256: "c".repeat(64) },
        ],
      },
      now,
    });
    for (const file of session.files) {
      await repo.recordUploadedFile({
        workspaceId: actor.workspace_id,
        sessionId: session.upload_session_id,
        path: file.path,
        objectKey: file.object_key,
        sizeBytes: file.size_bytes,
        uploadedAt: now,
      });
    }
    base = await repo.finalizeUploadSession({
      actor,
      idempotencyKey: `delete-only-base-finalize-${suffix}`,
      sessionId: session.upload_session_id,
      observedFiles: session.files.map((file) => ({
        path: file.path,
        objectKey: file.object_key,
        sizeBytes: file.size_bytes,
      })),
      now,
    });
    // Tree inheritance requires a published base (jobs normally performs this).
    await sql.query("update revisions set status = 'published' where id = $1", [base.revision_id]);
  }, 120_000);

  afterAll(async () => {
    await close?.();
  });

  function deltaRequest(deletedPaths: string[]) {
    return {
      title: "delete-only",
      artifact_id: base.artifact_id,
      base_revision_id: base.revision_id,
      entrypoint: "index.html",
      deleted_paths: deletedPaths,
      files: [],
    };
  }

  it("persists zero uploads, inherits the surviving tree, and replays finalize", async () => {
    const request = CreateUploadSessionRequest.parse(deltaRequest(["c.js"]));
    const session = await repo.createUploadSession({ actor, idempotencyKey: "delete-only-create", request, now });
    expect(session.files).toEqual([]);
    expect(
      (
        await sql.query("select file_count, size_bytes::integer as size_bytes from upload_sessions where id = $1", [
          session.upload_session_id,
        ])
      ).rows,
    ).toEqual([{ file_count: 0, size_bytes: 0 }]);
    expect(
      (await repo.getUploadSessionState({ workspaceId: actor.workspace_id, sessionId: session.upload_session_id }))
        ?.status,
    ).toBe("pending");
    const finalized = await repo.finalizeUploadSession({
      actor,
      idempotencyKey: "delete-only-finalize",
      sessionId: session.upload_session_id,
      observedFiles: [],
      now,
    });
    expect(finalized.file_count).toBe(2);
    expect(finalized.size_bytes).toBe(32);
    const tree = await sql.query(
      "select path, sha256, r2_key, storage_kind, size_bytes from artifact_files where revision_id = $1 order by path",
      [finalized.revision_id],
    );
    const original = await sql.query(
      "select path, sha256, r2_key, storage_kind, size_bytes from artifact_files where revision_id = $1 and path <> 'c.js' order by path",
      [base.revision_id],
    );
    expect(tree.rows).toEqual(original.rows);
    expect(tree.rows).toHaveLength(2);
    expect(
      (
        await sql.query(
          "select parent_revision_id, file_count, size_bytes::integer as size_bytes from revisions where id = $1",
          [finalized.revision_id],
        )
      ).rows,
    ).toEqual([{ parent_revision_id: base.revision_id, file_count: 2, size_bytes: 32 }]);
    expect(
      (await repo.getUploadSessionState({ workspaceId: actor.workspace_id, sessionId: session.upload_session_id }))
        ?.status,
    ).toBe("finalized");
    expect(
      await repo.finalizeUploadSession({
        actor,
        idempotencyKey: "delete-only-finalize-replay",
        sessionId: session.upload_session_id,
        observedFiles: [],
        now,
      }),
    ).toEqual(finalized);
    expect(
      (await sql.query("select path from artifact_files where revision_id = $1", [base.revision_id])).rows,
    ).toHaveLength(3);
    await expect(
      sql.query("update upload_sessions set file_count = -1 where id = $1", [session.upload_session_id]),
    ).rejects.toThrow("upload_sessions_file_count_check");
  });

  it("keeps empty full publishes and no-op deltas invalid", async () => {
    expect(CreateUploadSessionRequest.safeParse({ title: "empty", entrypoint: "index.html", files: [] }).success).toBe(
      false,
    );
    expect(CreateUploadSessionRequest.safeParse(deltaRequest([])).success).toBe(false);
    expect(
      CreateUploadSessionRequest.safeParse({
        title: "empty",
        entrypoint: "index.html",
        files: [],
        deleted_paths: ["c.js"],
      }).success,
    ).toBe(false);
    await expect(
      repo.createUploadSession({ actor, idempotencyKey: "empty-full", request: { files: [] }, now }),
    ).rejects.toThrow("file_count_cap_exceeded");
  });

  it("rejects an empty merged tree without committing a revision", async () => {
    const session = await repo.createUploadSession({
      actor,
      idempotencyKey: "delete-all-create",
      request: deltaRequest(["index.html", "b.css", "c.js"]),
      now,
    });
    await expect(
      repo.finalizeUploadSession({
        actor,
        idempotencyKey: "delete-all-finalize",
        sessionId: session.upload_session_id,
        observedFiles: [],
        now,
      }),
    ).rejects.toThrow("file_count_cap_exceeded");
    expect(
      (await repo.getUploadSessionState({ workspaceId: actor.workspace_id, sessionId: session.upload_session_id }))
        ?.status,
    ).toBe("pending");
    expect((await sql.query("select id from revisions where id = $1", [session.revision_id])).rows).toEqual([]);
  });
});
