import { and, eq, sql } from "drizzle-orm";
import type { DrizzleDb } from "../postgres/drizzle.js";
import { contentBlobs } from "../schema.js";
import type { ContentBlob } from "../types.js";
import type { WorkspaceBlobRef } from "./reparent-blobs.js";

export const contentBlobQueries = {
  async find(
    db: DrizzleDb,
    input: { workspaceId: string; sha256: string; sizeBytes: number },
  ): Promise<ContentBlob | null> {
    const rows = await db
      .select()
      .from(contentBlobs)
      .where(
        and(
          eq(contentBlobs.workspaceId, input.workspaceId),
          eq(contentBlobs.sha256, input.sha256),
          eq(contentBlobs.sizeBytes, input.sizeBytes),
        ),
      )
      .limit(1);
    return rows[0] ? mapContentBlob(rows[0]) : null;
  },

  async upsert(db: DrizzleDb, blob: ContentBlob) {
    await db
      .insert(contentBlobs)
      .values({
        workspaceId: blob.workspace_id,
        sha256: blob.sha256,
        sizeBytes: blob.size_bytes,
        r2Key: blob.r2_key,
        createdAt: new Date(blob.created_at),
        updatedAt: new Date(blob.updated_at),
      })
      .onConflictDoUpdate({
        target: [contentBlobs.workspaceId, contentBlobs.sha256, contentBlobs.sizeBytes],
        set: { r2Key: blob.r2_key, updatedAt: new Date(blob.updated_at) },
      });
  },

  async listForReparent(db: DrizzleDb, workspaceId: string): Promise<WorkspaceBlobRef[]> {
    const rows = await db.execute<WorkspaceBlobRef>(sql`
      select distinct sha256, size_bytes, r2_key
      from (
        select sha256, size_bytes, r2_key
        from artifact_files
        where workspace_id = ${workspaceId}
          and storage_kind = 'blob'
          and sha256 is not null
        union
        select sha256, size_bytes, r2_key
        from upload_session_files
        where workspace_id = ${workspaceId}
          and storage_kind = 'blob'
          and sha256 is not null
      ) blobs
    `);
    return rows;
  },

  async deleteUnreferenced(db: DrizzleDb, input: { now: string; limit: number }): Promise<ContentBlob[]> {
    const rows = await db.execute<{
      workspace_id: string;
      sha256: string;
      size_bytes: number;
      r2_key: string;
      created_at: Date;
      updated_at: Date;
    }>(sql`
      delete from content_blobs cb
      where ctid in (
        select cb_inner.ctid
        from content_blobs cb_inner
        where not exists (
          select 1
          from artifact_files af
          inner join revisions r
            on r.workspace_id = af.workspace_id
           and r.artifact_id = af.artifact_id
           and r.id = af.revision_id
          inner join artifacts a
            on a.workspace_id = af.workspace_id
           and a.id = af.artifact_id
          where af.workspace_id = cb_inner.workspace_id
            and af.sha256 = cb_inner.sha256
            and af.size_bytes = cb_inner.size_bytes
            and af.storage_kind = 'blob'
            and a.status = 'active'
            and r.status in ('draft', 'published')
        )
        and not exists (
          select 1
          from upload_session_files usf
          inner join upload_sessions us on us.id = usf.upload_session_id
          where usf.workspace_id = cb_inner.workspace_id
            and usf.sha256 = cb_inner.sha256
            and usf.size_bytes = cb_inner.size_bytes
            and usf.storage_kind = 'blob'
            and us.status = 'pending'
            and us.expires_at > ${new Date(input.now)}
        )
        order by cb_inner.updated_at asc
        limit ${input.limit}
      )
      returning workspace_id, sha256, size_bytes, r2_key, created_at, updated_at
    `);
    return rows.map((row) =>
      mapContentBlob({
        workspaceId: row.workspace_id,
        sha256: row.sha256,
        sizeBytes: Number(row.size_bytes),
        r2Key: row.r2_key,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
      }),
    );
  },
};

function mapContentBlob(row: typeof contentBlobs.$inferSelect): ContentBlob {
  return {
    workspace_id: row.workspaceId,
    sha256: row.sha256,
    size_bytes: Number(row.sizeBytes),
    r2_key: row.r2Key,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}
