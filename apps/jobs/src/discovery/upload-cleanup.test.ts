import { workspaceBlobObjectKeyFor } from "@agent-paste/storage";
import { PGlite } from "@electric-sql/pglite";
import { expect, it, vi } from "vitest";
import {
  applyMigrations,
  executorForPglite,
  seedPublishedRevision,
  workspaceExecutor,
} from "../test-helpers/pglite.js";
import { runUploadCleanupDiscovery } from "./upload-cleanup.js";

it("expires pending and ready sessions and purges only legacy session prefixes", async () => {
  const client = new PGlite();
  try {
    await applyMigrations(client);
    const executor = executorForPglite(client);
    const workspaceId = "00000000-0000-4000-8000-000000000077";
    const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z7";
    const revisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z7";
    const apiKeyId = "key_01HZY7Q8X9Y2S3T4V5W6X7Y8Z7";
    const blobKey = workspaceBlobObjectKeyFor({ workspaceId, sha256: "a".repeat(64) });
    const legacyKey = `artifacts/${artifactId}/revisions/${revisionId}/files/index.html`;
    await seedPublishedRevision(executor, { workspaceId, artifactId, revisionId, apiKeyId, r2Key: blobKey });
    const tenant = workspaceExecutor(executor, workspaceId);
    const sessions = ["pending", "ready", "finalized", "ready"].map((status, index) => ({
      id: `upl_01HZY7Q8X9Y2S3T4V5W6X7Y8Z${index}`,
      status,
    }));
    for (const [index, s] of sessions.entries()) {
      await tenant.query(
        `insert into upload_sessions (id,workspace_id,artifact_id,revision_id,status,title,entrypoint,artifact_expires_at,file_count,size_bytes,created_by_type,created_by_id,expires_at,created_at) values ($1,$2,$3,$4,$5,'cleanup','index.html',now()+interval '1 day',1,4,'api_key',$6,$7,now())`,
        [
          s.id,
          workspaceId,
          artifactId,
          revisionId,
          s.status,
          apiKeyId,
          new Date(Date.now() + (index === 3 ? 3600_000 : -3600_000)).toISOString(),
        ],
      );
      await tenant.query(
        `insert into upload_session_files (workspace_id,upload_session_id,path,size_bytes,served_content_type,r2_key,storage_kind,put_url_expires_at) values ($1,$2,'index.html',4,'text/html',$3,$4,now())`,
        [workspaceId, s.id, index === 0 ? legacyKey : blobKey, index === 0 ? "revision" : "blob"],
      );
    }
    await tenant.query(
      `insert into content_blobs (workspace_id,sha256,size_bytes,r2_key,created_at,updated_at) values ($1,$2,4,$3,now(),now())`,
      [workspaceId, "a".repeat(64), blobKey],
    );
    const send = vi.fn();
    const result = await runUploadCleanupDiscovery(executor, { send, sendBatch: vi.fn() }, new Date().toISOString());
    expect(result).toMatchObject({ discovered: 2, enqueued: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      reason: "upload_cleanup",
      prefixes: [legacyKey.slice(0, legacyKey.lastIndexOf("/") + 1)],
    });
    expect(
      (await tenant.query<{ status: string }>("select status from upload_sessions order by id")).rows.map(
        (v) => v.status,
      ),
    ).toEqual(["expired", "expired", "finalized", "ready"]);
    expect((await tenant.query("select * from content_blobs")).rows).toHaveLength(1);
  } finally {
    await client.close();
  }
}, 30_000);
