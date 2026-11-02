import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APP_RUNTIME_ROLE, RUNTIME_ROLE_GUC, RUNTIME_ROLE_PASSWORD_GUC } from "../../scripts/credentials.mjs";

const migrations = new URL("../../migrations/", import.meta.url);
const workspaceId = "00000000-0000-4000-8000-000000000001";
const migration = await readFile(new URL("0033_persistent_static_hosting.sql", migrations), "utf8");

describe("persistent hosting additive migration", () => {
  const db = new PGlite();
  beforeAll(async () => {
    for (const file of (await readdir(migrations)).filter((name) => name.endsWith(".sql") && name < "0033").sort()) {
      if (file === "0010_db_roles.sql")
        await db.exec(
          `select set_config('${RUNTIME_ROLE_GUC}', '${APP_RUNTIME_ROLE}', false); select set_config('${RUNTIME_ROLE_PASSWORD_GUC}', 'migration-test-password', false)`,
        );
      await db.exec(await readFile(new URL(file, migrations), "utf8"));
    }
    await db.exec(`insert into workspaces (id, name, created_at, updated_at) values ('${workspaceId}', 'Migration test', now(), now());
      insert into content_blobs (workspace_id, sha256, size_bytes, r2_key, created_at, updated_at)
      values ('${workspaceId}', '${"a".repeat(64)}', 3, 'old-object-key', now(), now());
      insert into upload_sessions (id, workspace_id, artifact_id, revision_id, status, title, entrypoint, artifact_expires_at, file_count, size_bytes, created_by_type, created_by_id, expires_at, created_at)
      values ('upl_old', '${workspaceId}', 'art_old', 'rev_old', 'failed', 'Old', 'index.html', now(), 1, 3, 'api_key', 'key_old', now(), now());`);
    await db.exec(migration);
  }, 30_000);
  afterAll(() => db.close());

  it("preserves historical blobs, seals legacy sessions, and allows guarded ready sessions", async () => {
    expect(
      (await db.query("select r2_key, content_format, gc_state, r2_cleanup_eligible from content_blobs")).rows,
    ).toEqual([{ r2_key: "old-object-key", content_format: "single", gc_state: "live", r2_cleanup_eligible: false }]);
    expect(
      (await db.query("select status, sealed_at = created_at as sealed, next_batch_index from upload_sessions")).rows,
    ).toEqual([{ status: "failed", sealed: true, next_batch_index: 1 }]);
    await db.exec(
      "update upload_sessions set status = 'ready', commit_guard = 'paths', sealed_at = null where id = 'upl_old'",
    );
    await db.exec(`insert into content_blobs (workspace_id, sha256, size_bytes, r2_key, created_at, updated_at)
      values ('${workspaceId}', '${"b".repeat(64)}', 4, 'new-object-key', now(), now())`);
    await db.exec(migration);
    expect((await db.query("select r2_key, r2_cleanup_eligible from content_blobs order by r2_key")).rows).toEqual([
      { r2_key: "new-object-key", r2_cleanup_eligible: true },
      { r2_key: "old-object-key", r2_cleanup_eligible: false },
    ]);
    expect((await db.query("select sealed_at from upload_sessions where id = 'upl_old'")).rows).toEqual([
      { sealed_at: null },
    ]);
  });
  it("adds forced tenant RLS to every new table", async () => {
    const rows = (
      await db.query(
        "select relname, relrowsecurity, relforcerowsecurity from pg_class where relname in ('upload_session_chunks', 'upload_session_deletions', 'content_blob_chunks') order by relname",
      )
    ).rows;
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.relrowsecurity === true && row.relforcerowsecurity === true)).toBe(true);
  });
});
