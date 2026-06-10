import { workspaceBlobObjectKeyFor } from "@agent-paste/storage";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import {
  applyMigrations,
  executorForPglite,
  platformExecutor,
  seedPublishedRevision,
  workspaceExecutor,
} from "../test-helpers/pglite.js";
import { runContentBlobGc } from "./content-blob-gc.js";

const workspaceId = "00000000-0000-4000-8000-000000000077";
const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z7";
const revisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z7";
const apiKeyId = "key_01HZY7Q8X9Y2S3T4V5W6X7Y8Z7";
const referencedSha = "a".repeat(64);
const pendingSha = "b".repeat(64);
const orphanSha = "c".repeat(64);

describe("content blob GC", () => {
  it("de-indexes only blobs with no active artifact or pending upload-session reference", async () => {
    const client = new PGlite();
    await applyMigrations(client);
    const executor = executorForPglite(client);
    const referencedKey = workspaceBlobObjectKeyFor({ workspaceId, sha256: referencedSha });
    const pendingKey = workspaceBlobObjectKeyFor({ workspaceId, sha256: pendingSha });
    const orphanKey = workspaceBlobObjectKeyFor({ workspaceId, sha256: orphanSha });

    await seedPublishedRevision(executor, {
      workspaceId,
      artifactId,
      revisionId,
      apiKeyId,
      r2Key: referencedKey,
    });
    const tenant = workspaceExecutor(executor, workspaceId);
    await tenant.query(
      `update artifact_files
       set sha256 = $1, storage_kind = 'blob', size_bytes = 5, r2_key = $2
       where artifact_id = $3 and revision_id = $4 and path = 'index.html'`,
      [referencedSha, referencedKey, artifactId, revisionId],
    );
    await tenant.query(
      `insert into upload_sessions
         (id, workspace_id, artifact_id, revision_id, status, title, entrypoint, artifact_expires_at,
          file_count, size_bytes, created_by_type, created_by_id, expires_at, created_at)
       values ('upl_gc_pending', $1, 'art_pending', 'rev_pending', 'pending', 'pending', 'pending.txt',
         now() + interval '1 day', 1, 5, 'api_key', $2, now() + interval '1 day', now())`,
      [workspaceId, apiKeyId],
    );
    await tenant.query(
      `insert into upload_session_files
         (workspace_id, upload_session_id, path, size_bytes, served_content_type, r2_key, sha256, storage_kind,
          uploaded_at, put_url_expires_at)
       values ($1, 'upl_gc_pending', 'pending.txt', 5, 'text/plain', $2, $3, 'blob', now(), now() + interval '1 day')`,
      [workspaceId, pendingKey, pendingSha],
    );
    await platformExecutor(executor).query(
      `insert into content_blobs (workspace_id, sha256, size_bytes, r2_key, created_at, updated_at)
       values
         ($1, $2, 5, $3, now() - interval '3 days', now() - interval '3 days'),
         ($1, $4, 5, $5, now() - interval '2 days', now() - interval '2 days'),
         ($1, $6, 5, $7, now() - interval '1 day', now() - interval '1 day')`,
      [workspaceId, referencedSha, referencedKey, pendingSha, pendingKey, orphanSha, orphanKey],
    );
    const result = await runContentBlobGc(executor, "2026-06-01T00:00:00.000Z");

    expect(result.discovered).toBe(1);
    const remaining = await platformExecutor(executor).query<{ sha256: string }>(
      `select sha256 from content_blobs order by sha256 asc`,
    );
    expect(remaining.rows.map((row) => row.sha256)).toEqual([referencedSha, pendingSha]);
  }, 10_000);
});
