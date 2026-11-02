import { and, asc, eq } from "drizzle-orm";
import { storageUsageQuery } from "../../queries/storage-usage.js";
import {
  contentBlobChunks,
  revisions,
  uploadSessionChunks,
  uploadSessionDeletions,
  uploadSessionFiles,
  uploadSessions,
} from "../../schema.js";
import type { PersistentEntities } from "../persistent-ports.js";
import type { PostgresContext } from "./context.js";

export function postgresPersistent({ sql, drizzle: db }: PostgresContext): PersistentEntities {
  return {
    async lockLiveContentBlob(ws, sha, size) {
      const rows = await sql.query(
        "select sha256 from content_blobs where workspace_id=$1 and sha256=$2 and size_bytes=$3 and gc_state='live' for share",
        [ws, sha, size],
      );
      return rows.rows.length > 0;
    },
    async lockWorkspace(id) {
      await sql.query("select id from workspaces where id = $1 for update", [id]);
    },
    async lockArtifact(id, workspaceId) {
      await sql.query("select id from artifacts where id = $1 and workspace_id = $2 for update", [id, workspaceId]);
    },
    async updateSession(s) {
      await db
        .update(uploadSessions)
        .set({
          status: s.status,
          fileCount: s.file_count,
          sizeBytes: s.size_bytes,
          sealedAt: s.sealed_at ? new Date(s.sealed_at) : null,
          nextBatchIndex: s.next_batch_index ?? 1,
          finalizedAt: s.finalized_at ? new Date(s.finalized_at) : null,
        })
        .where(eq(uploadSessions.id, s.id));
    },
    async updateFile(sid, f) {
      await db
        .update(uploadSessionFiles)
        .set({
          sizeBytes: f.size_bytes,
          r2Key: f.r2_key,
          sha256: f.sha256 ?? null,
          storageKind: f.storage_kind ?? "revision",
          contentFormat: f.content_format ?? "single",
          uploadedAt: f.uploaded_at ? new Date(f.uploaded_at) : null,
          verifiedAt: f.verified_at ? new Date(f.verified_at) : null,
          patchBaseSha256: f.patch_base_sha256 ?? null,
          patchResultSha256: f.patch_result_sha256 ?? null,
        })
        .where(and(eq(uploadSessionFiles.uploadSessionId, sid), eq(uploadSessionFiles.path, f.path)));
    },
    ...chunkEntities(db),
    async setFileMap(id, sha, size) {
      await db.update(revisions).set({ fileMapSha256: sha, fileMapSizeBytes: size }).where(eq(revisions.id, id));
    },
    storageUsage: (ws, now) => storageUsageQuery(sql, ws, now),
  };
}

function chunkEntities(db: PostgresContext["drizzle"]) {
  return {
    async insertChunks(chunks) {
      for (let i = 0; i < chunks.length; i += 1000)
        await db.insert(uploadSessionChunks).values(
          chunks.slice(i, i + 1000).map((c) => ({
            workspaceId: c.workspace_id,
            uploadSessionId: c.upload_session_id,
            path: c.path,
            chunkIndex: c.chunk_index,
            sha256: c.sha256,
            sizeBytes: c.size_bytes,
            uploadedAt: c.uploaded_at ? new Date(c.uploaded_at) : null,
          })),
        );
    },
    async listChunks(sid, path) {
      const rows = await db
        .select()
        .from(uploadSessionChunks)
        .where(
          and(
            eq(uploadSessionChunks.uploadSessionId, sid),
            path === undefined ? undefined : eq(uploadSessionChunks.path, path),
          ),
        )
        .orderBy(asc(uploadSessionChunks.path), asc(uploadSessionChunks.chunkIndex));
      return rows.map((c) => ({
        workspace_id: c.workspaceId,
        upload_session_id: c.uploadSessionId,
        path: c.path,
        chunk_index: c.chunkIndex,
        sha256: c.sha256,
        size_bytes: Number(c.sizeBytes),
        uploaded_at: c.uploadedAt?.toISOString() ?? null,
      }));
    },
    async markChunkUploaded(sid, path, index, now) {
      await db
        .update(uploadSessionChunks)
        .set({ uploadedAt: new Date(now) })
        .where(
          and(
            eq(uploadSessionChunks.uploadSessionId, sid),
            eq(uploadSessionChunks.path, path),
            eq(uploadSessionChunks.chunkIndex, index),
          ),
        );
    },
    ...deletionEntities(db),
    async insertBlobChunks(rows) {
      if (rows.length)
        await db
          .insert(contentBlobChunks)
          .values(
            rows.map((c) => ({
              workspaceId: c.workspace_id,
              sha256: c.sha256,
              sizeBytes: c.size_bytes,
              chunkIndex: c.chunk_index,
              chunkSha256: c.chunk_sha256,
              chunkSizeBytes: c.chunk_size_bytes,
            })),
          )
          .onConflictDoNothing();
    },
    async listBlobChunks(ws, sha, size) {
      return (
        await db
          .select()
          .from(contentBlobChunks)
          .where(
            and(
              eq(contentBlobChunks.workspaceId, ws),
              eq(contentBlobChunks.sha256, sha),
              eq(contentBlobChunks.sizeBytes, size),
            ),
          )
          .orderBy(asc(contentBlobChunks.chunkIndex))
      ).map((c) => ({
        workspace_id: c.workspaceId,
        sha256: c.sha256,
        size_bytes: Number(c.sizeBytes),
        chunk_index: c.chunkIndex,
        chunk_sha256: c.chunkSha256,
        chunk_size_bytes: Number(c.chunkSizeBytes),
      }));
    },
  } satisfies Pick<
    PersistentEntities,
    "insertChunks" | "listChunks" | "markChunkUploaded" | "insertBlobChunks" | "listBlobChunks"
  >;
}

function deletionEntities(db: PostgresContext["drizzle"]) {
  return {
    async insertDeletions(rows) {
      if (rows.length)
        await db.insert(uploadSessionDeletions).values(
          rows.map((d) => ({
            workspaceId: d.workspace_id,
            uploadSessionId: d.upload_session_id,
            kind: d.kind,
            path: d.path,
            expectSha256: d.expect_sha256,
            expectSizeBytes: d.expect_size_bytes,
            expectSnapshotSha256: d.expect_snapshot_sha256,
            batchIndex: d.batch_index,
          })),
        );
    },
    async listDeletions(sid) {
      return (
        await db.select().from(uploadSessionDeletions).where(eq(uploadSessionDeletions.uploadSessionId, sid))
      ).map((d) => ({
        workspace_id: d.workspaceId,
        upload_session_id: d.uploadSessionId,
        kind: d.kind as "path" | "prefix",
        path: d.path,
        expect_sha256: d.expectSha256,
        expect_size_bytes: d.expectSizeBytes == null ? null : Number(d.expectSizeBytes),
        expect_snapshot_sha256: d.expectSnapshotSha256,
        batch_index: d.batchIndex,
      }));
    },
  } satisfies Pick<PersistentEntities, "insertDeletions" | "listDeletions">;
}
